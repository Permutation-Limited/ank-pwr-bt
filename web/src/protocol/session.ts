// SOLIX negotiation and session, ported from SolixBLE (protocols/session.py,
// protocols/ecdh.py, device.py). Transport-agnostic: feed it notification
// bytes and give it a write function.
//
// Negotiation (client request -> device reply, msgtype | 0x800):
//   x001 open              -> x801
//   x003 MTU/encrypt caps  -> x803 device capabilities (mtu, methods, auth)
//   x029                   -> x829 identity (serial a4, MAC a5)
//   x005 choose ECDH       -> x805
//   x021 our public key    -> x821 device public key  => session keys
//   x022 time + timezone   -> x822
//   x027 register token    -> x827 status 00 = authorized, 09 = press button
// The plain outer is authorized at the key exchange; the encrypted outer
// needs x027 (and maybe a button press on the device).

import { concat, hex, i32le, readUintLE, u16le, u32le, u8, utf8 } from "./bytes";
import {
  type OuterName, type SessionKeys, deriveSessionKeys, generateEcdhKey, openFor, publicXY, sealFor,
} from "./crypto";
import {
  CHANNEL_APP, CHANNEL_NEGOTIATION, CHANNEL_SESSION, PATTERN_NEGOTIATION, PATTERN_SESSION,
  type Params, Reassembler, buildCommand, buildPacket, buildParams, channelOf, parseCommand,
  parsePacket, parseParams,
} from "./packet";
import { fromHex } from "./bytes";
import { offsetSecondsWest, posixTimezone } from "./timezone";

/** Client id SolixBLE sends (a2 on the plain outer) and registers in x027. */
export const CLIENT_ID = "b2dc0b17-b75d-4abf-ba6e-ec7c997c23e7";

const CLIENT_ENCRYPT = 0x20;
const CLIENT_MTU = 0xf000;
const ECDH_METHOD: Record<OuterName, number> = { plain: 0x40, encrypted: 0x44 };
const STATUS_OK = 0x00;
const STATUS_CONFIRM = 0x09;

export type SessionState =
  | "idle" | "negotiating" | "awaiting-confirmation" | "authorized" | "failed";

export interface Announcement {
  mtu?: number;
  baseMethod?: number;
  encryptMethod?: number;
  authMethod?: number;
  chip?: string;
  firmware?: string;
  serial?: string;
  mac?: string;
  registrationStatus?: number;
  confirmationWindow?: number;
}

export interface SessionMessage {
  cmd: string; // hex, e.g. "c421"
  msgtype: number;
  encrypted: boolean;
  status: number | null;
  params: Params;
}

export interface SessionOptions {
  outer: OuterName;
  write(frame: Uint8Array): Promise<void>;
  log?(msg: string): void;
  onState?(state: SessionState, session: SolixSession): void;
  onMessage?(msg: SessionMessage): void;
  /** Unix seconds; injectable for tests. */
  now?(): number;
  generateKey?(): Promise<CryptoKeyPair>;
  timezone?(): { offsetWest: number; posix: string };
  clientId?: string;
}

type Tags = [number, Uint8Array][];

const ascii = (b?: Uint8Array) =>
  b ? new TextDecoder("ascii").decode(b).replace(/[^\x20-\x7e]/g, "") : undefined;

export class SolixSession {
  readonly outer: OuterName;
  readonly announcement: Announcement = {};
  state: SessionState = "idle";
  replied = false;
  error?: string;

  private keys: SessionKeys | null = null;
  private keyPair: CryptoKeyPair | null = null;
  private authorized = false;
  private reassembler = new Reassembler();
  private queue: Promise<void> = Promise.resolve();
  private readonly opts: SessionOptions;
  private readonly clientId: string;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.outer = opts.outer;
    this.clientId = opts.clientId ?? CLIENT_ID;
  }

  private log(msg: string) { this.opts.log?.(msg); }
  private now() { return this.opts.now?.() ?? Math.floor(Date.now() / 1000); }
  private ts() { return u32le(this.now()); }

  private setState(s: SessionState) {
    if (this.state === s) return;
    this.state = s;
    this.opts.onState?.(s, this);
  }

  get isAuthorized() { return this.state === "authorized"; }

  /** Send the opening x001 (call again to restart a stalled negotiation). */
  async open() {
    this.keys = null;
    this.keyPair = null;
    this.authorized = false;
    this.setState("negotiating");
    await this.sendNegotiation(0x001, [[0xa1, this.ts()]], true);
  }

  /** Feed one notification from the telemetry characteristic. */
  handleNotification(data: Uint8Array): Promise<void> {
    // Serialize: replies must be handled in order, and handling is async.
    this.queue = this.queue.then(() => this.process(data)).catch((e) => {
      this.log(`error handling ${hex(data)}: ${e instanceof Error ? e.message : e}`);
    });
    return this.queue;
  }

  /** Send a session command (pattern 03000f) once authorized. ``cmd`` includes flag bits, e.g. "4100". */
  async sendCommand(cmd: string, tags: Tags) {
    if (!this.keys) throw new Error("no session keys yet");
    // Every session command carries a typed (03) timestamp under tag fe.
    const payload = buildParams([...tags, [0xfe, concat(u8(3), this.ts())]]);
    await this.writeFrame(PATTERN_SESSION, fromHex(cmd), payload);
  }

  // ---------------------------------------------------------------- internals

  private async writeFrame(pattern: string, cmd: Uint8Array, plaintext: Uint8Array) {
    const sealed = await sealFor(this.outer, this.keys, plaintext);
    const frame = buildPacket(fromHex(pattern), cmd, sealed);
    this.log(`→ ${hex(cmd)} ${hex(plaintext)}`);
    await this.opts.write(frame);
  }

  private async sendNegotiation(msgtype: number, tags: Tags, clientId = false) {
    if (clientId && this.outer === "plain") {
      const [first, ...rest] = tags;
      tags = [first!, [0xa2, utf8(this.clientId)], ...rest];
    }
    const encrypted = this.outer === "encrypted" || this.keys !== null;
    await this.writeFrame(PATTERN_NEGOTIATION, buildCommand({ encrypted, msgtype }), buildParams(tags));
  }

  private async process(data: Uint8Array) {
    const packet = parsePacket(data);
    const command = parseCommand(packet.cmd);
    let payload: Uint8Array | null = packet.payload;
    if (command.fragmented) {
      payload = this.reassembler.push(packet);
      if (!payload) return;
    }
    const channel = channelOf(packet.pattern);
    if (command.encrypted) payload = await openFor(this.outer, this.keys, payload);
    const parsed = parseParams(payload);
    this.log(`← ${hex(packet.pattern)} ${hex(packet.cmd)} ${hex(payload)}`);

    if (channel === CHANNEL_NEGOTIATION) {
      this.replied = true;
      await this.onNegotiation(command.msgtype, parsed.status ?? 0xff, parsed.params);
      return;
    }
    if (channel === CHANNEL_SESSION || channel === CHANNEL_APP) {
      // An encrypted push we could decrypt proves we're authorized.
      if (command.encrypted && this.keys) this.markAuthorized();
      this.opts.onMessage?.({
        cmd: hex(packet.cmd), msgtype: command.msgtype, encrypted: command.encrypted,
        status: parsed.status, params: parsed.params,
      });
      return;
    }
    this.log(`unhandled channel ${channel.toString(16)}`);
  }

  private markAuthorized() {
    this.authorized = true;
    this.setState("authorized");
  }

  private async onNegotiation(msgtype: number, status: number, p: Params) {
    const a = this.announcement;
    switch (msgtype) {
      case 0x801:
        await this.sendNegotiation(0x003, [
          [0xa1, this.ts()], [0xa3, u8(CLIENT_ENCRYPT)], [0xa4, u16le(CLIENT_MTU)],
        ], true);
        break;
      case 0x803:
        a.baseMethod = p.get(0xa1)?.[0];
        a.mtu = p.has(0xa2) ? readUintLE(p.get(0xa2)!) : undefined;
        a.encryptMethod = p.get(0xa3)?.[0];
        a.authMethod = p.get(0xa5)?.[0];
        if (a.encryptMethod !== undefined && !(a.encryptMethod & 0x44)) {
          this.fail(`device does not offer ECDH (encrypt_method=0x${a.encryptMethod.toString(16)})`);
          return;
        }
        await this.sendNegotiation(0x029, [[0xa1, this.ts()]], true);
        break;
      case 0x829: {
        a.chip = ascii(p.get(0xa2));
        a.firmware = ascii(p.get(0xa3));
        a.serial = ascii(p.get(0xa4));
        const mac = p.get(0xa5);
        if (mac) a.mac = Array.from(mac, (x) => x.toString(16).padStart(2, "0")).join(":").toUpperCase();
        const tags: Tags = [[0xa1, this.ts()], [0xa3, u8(CLIENT_ENCRYPT)]];
        if (this.outer === "plain") {
          tags.push([0xa4, u16le(CLIENT_MTU)], [0xa5, u8(ECDH_METHOD.plain)]);
        } else {
          tags.push([0xa4, u16le(a.mtu ?? CLIENT_MTU)], [0xa5, u8(ECDH_METHOD.encrypted)]);
          if (a.authMethod !== undefined) tags.push([0xa6, u8(a.authMethod)]);
        }
        await this.sendNegotiation(0x005, tags, true);
        break;
      }
      case 0x805:
        this.keyPair = await (this.opts.generateKey ?? generateEcdhKey)();
        await this.sendNegotiation(0x021, [[0xa1, await publicXY(this.keyPair)]]);
        break;
      case 0x821: {
        const deviceXY = p.get(0xa1);
        if (!this.keyPair || !deviceXY || deviceXY.length !== 64) {
          this.fail("x821 without a usable device key");
          return;
        }
        this.keys = await deriveSessionKeys(this.keyPair, deviceXY);
        this.log("session keys derived");
        if (this.outer === "plain") this.authorized = true;
        const tz = this.opts.timezone?.() ?? { offsetWest: offsetSecondsWest(), posix: posixTimezone() };
        await this.sendNegotiation(0x022, [
          [0xa1, this.ts()], [0xa3, i32le(tz.offsetWest)], [0xa5, utf8(tz.posix)],
        ], true);
        break;
      }
      case 0x822:
        if (this.authorized) this.markAuthorized();
        else await this.sendNegotiation(0x027, [[0xa1, this.ts()], [0xa2, utf8(this.clientId)]]);
        break;
      case 0x827:
        a.registrationStatus = status;
        if (status === STATUS_OK) {
          this.markAuthorized();
        } else if (status === STATUS_CONFIRM) {
          const w = p.get(0xa1);
          a.confirmationWindow = w ? readUintLE(w.subarray(-2)) : undefined;
          this.setState("awaiting-confirmation");
        } else {
          this.fail(`registration refused (status 0x${status.toString(16)})`);
        }
        break;
      default:
        this.log(`unhandled negotiation reply 0x${msgtype.toString(16)} status ${status}`);
    }
  }

  private fail(msg: string) {
    this.error = msg;
    this.log(msg);
    this.setState("failed");
  }
}
