// Anker ``ff09`` frame format, ported from SolixBLE's constructs.py.
//
//   ff 09 | length u16le | pattern (3) | cmd (2) | payload | xor checksum
//
// length is the whole frame including the checksum (10 + payload length).
// pattern = 03 <composer> <channel>; cmd = flags nibble + 12-bit message type.

import { concat, hex, readUintLE, u16le } from "./bytes";

export const CHANNEL_NEGOTIATION = 0x01;
export const CHANNEL_SESSION = 0x0f;
export const CHANNEL_APP = 0x11;

export const PATTERN_NEGOTIATION = "030001";
export const PATTERN_SESSION = "03000f";

export interface Packet {
  pattern: Uint8Array; // 3 bytes
  cmd: Uint8Array; // 2 bytes
  payload: Uint8Array;
}

export interface Command {
  fragmented: boolean;
  encrypted: boolean;
  msgtype: number; // 12 bits; replies have 0x800 set
}

const xor = (b: Uint8Array) => b.reduce((a, x) => a ^ x, 0);

export function buildPacket(pattern: Uint8Array, cmd: Uint8Array, payload: Uint8Array): Uint8Array {
  const body = concat(Uint8Array.of(0xff, 0x09), u16le(10 + payload.length), pattern, cmd, payload);
  return concat(body, Uint8Array.of(xor(body)));
}

export function parsePacket(data: Uint8Array): Packet {
  if (data.length < 11 || data[0] !== 0xff || data[1] !== 0x09) {
    throw new Error(`not an ff09 frame: ${hex(data)}`);
  }
  const length = data[2]! | (data[3]! << 8);
  if (data.length !== length) throw new Error(`frame length field ${length} != ${data.length} bytes`);
  const checksum = xor(data.subarray(0, length - 1));
  if (checksum !== data[length - 1]) throw new Error(`bad checksum in ${hex(data)}`);
  return {
    pattern: data.slice(4, 7),
    cmd: data.slice(7, 9),
    payload: data.slice(9, length - 1),
  };
}

export function parseCommand(cmd: Uint8Array): Command {
  const v = (cmd[0]! << 8) | cmd[1]!;
  return { fragmented: !!(v & 0x8000), encrypted: !!(v & 0x4000), msgtype: v & 0x0fff };
}

export function buildCommand(c: Omit<Command, "fragmented"> & { fragmented?: boolean }): Uint8Array {
  const v = (c.fragmented ? 0x8000 : 0) | (c.encrypted ? 0x4000 : 0) | (c.msgtype & 0x0fff);
  return Uint8Array.of(v >> 8, v & 0xff);
}

export const channelOf = (pattern: Uint8Array) => pattern[2]!;

// ------------------------------------------------------------------ TLV params

/** A tag's raw bytes. SolixBLE's ``value_legacy``: a type byte, if any, is included. */
export type Params = Map<number, Uint8Array>;

export interface ParsedParams {
  status: number | null; // reply status byte; null on pushes
  params: Params;
}

/** TLV tags start at 0xa1; a lower first byte is a reply's status byte. */
const STATUS_LIMIT = 0xa1;

export function parseParams(payload: Uint8Array): ParsedParams {
  let i = 0;
  let status: number | null = null;
  if (payload.length && payload[0]! < STATUS_LIMIT) status = payload[i++]!;
  const params: Params = new Map();
  while (i + 2 <= payload.length) {
    const key = payload[i]!;
    const len = payload[i + 1]!;
    if (i + 2 + len > payload.length) break;
    params.set(key, payload.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
  return { status, params };
}

/** Encode tags in insertion order. Values are raw bytes (include any type byte). */
export function buildParams(params: [number, Uint8Array][]): Uint8Array {
  return concat(...params.flatMap(([k, v]) => [Uint8Array.of(k, v.length), v]));
}

export const paramInt = (p: Params, key: number, begin = 0, end?: number, signed = false) => {
  const v = p.get(key);
  return v ? readUintLE(v.subarray(begin, end), signed) : undefined;
};

// ------------------------------------------------------------------ fragments

/**
 * Collects fragmented payloads. Each fragment's first byte is
 * ``index << 4 | total`` with 1-based indices; fragments arrive in order.
 */
export class Reassembler {
  private buffers = new Map<string, Uint8Array[]>();

  push(p: Packet): Uint8Array | null {
    const key = hex(p.pattern) + hex(p.cmd);
    const frag = p.payload[0]!;
    const index = frag >> 4;
    const total = frag & 0x0f;
    const list = this.buffers.get(key) ?? [];
    this.buffers.set(key, list);
    list.push(p.payload.subarray(1));
    if (index !== list.length) { list.length = 0; return null; }
    if (total !== list.length) return null;
    const out = concat(...list);
    list.length = 0;
    return out;
  }
}
