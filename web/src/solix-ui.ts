// Connects a SolixSession to a Web Bluetooth device and renders its state.

import { hex } from "./solix/bytes";
import type { OuterName } from "./solix/crypto";
import { CAPABILITY_ENCRYPTED_ECDH, type AnkerRecord } from "./solix/advertisement";
import { type SessionMessage, type SessionState, SolixSession } from "./solix/session";
import { SUBSCRIBE_CMD, SUBSCRIBE_TAGS, decodeGen2 } from "./solix/telemetry";
import { SOLIX_COMMAND, SOLIX_GATT_CANDIDATES, SOLIX_TELEMETRY } from "./uuids";

const OPEN_RETRY_MS = 8000;
const MAX_OPENS = 3;

export interface SolixUiDeps {
  log(msg: string, cls?: string): void;
  outerPreference(): "auto" | OuterName;
  autoSubscribe(): boolean;
  /** Latest Anker advertisement record, if watchAdvertisements delivered one. */
  advertisement(): AnkerRecord | null;
  /** Reconnect GATT (used when falling back to the encrypted outer). */
  reconnect(): Promise<boolean>;
  /** Called once negotiation settles (authorized, failed or gave up). */
  settled(): void;
}

const $ = (id: string) => document.getElementById(id)!;

function fillKv(dl: HTMLElement, rows: [string, string][]) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    return [dt, dd];
  }));
}

export class SolixController {
  session: SolixSession | null = null;
  private notify: BluetoothRemoteGATTCharacteristic | null = null;
  private write: BluetoothRemoteGATTCharacteristic | null = null;
  private retryTimer: number | undefined;
  private opens = 0;
  private triedEncryptedFallback = false;
  private lastParams = new Map<string, Map<number, string>>();
  private settledOnce = false;

  constructor(private readonly deps: SolixUiDeps) {}

  /** Returns false if the device has no SOLIX ff09 service. */
  async attach(device: BluetoothDevice): Promise<boolean> {
    this.stop();
    let found: [BluetoothRemoteGATTCharacteristic, BluetoothRemoteGATTCharacteristic] | null = null;
    for (const uuid of SOLIX_GATT_CANDIDATES) {
      try {
        const service = await device.gatt!.getPrimaryService(uuid);
        const write = await service.getCharacteristic(SOLIX_COMMAND);
        const notify = await service.getCharacteristic(SOLIX_TELEMETRY);
        found = [write, notify];
        this.deps.log(`SOLIX characteristics found in service ${uuid}`);
        break;
      } catch (e) {
        this.deps.log(`service ${uuid}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (!found) {
      this.deps.log("no SOLIX command/telemetry characteristics found; skipping the SOLIX handshake", "err");
      this.render();
      return false;
    }
    [this.write, this.notify] = found;
    this.notify.addEventListener("characteristicvaluechanged", this.onValue);
    await this.notify.startNotifications();
    this.deps.log("subscribed to SOLIX telemetry characteristic");
    await this.start(this.chooseOuter());
    return true;
  }

  /** Drop the current session (user disconnect, or before a fresh attach). */
  stop() {
    clearTimeout(this.retryTimer);
    this.notify?.removeEventListener("characteristicvaluechanged", this.onValue);
    this.notify = null;
    this.write = null;
    this.session = null;
  }

  /** Called on GATT disconnect. Falls back to the encrypted outer once if the plain one was refused. */
  async onDisconnected() {
    const s = this.session;
    clearTimeout(this.retryTimer);
    if (s && !s.replied && s.outer === "plain" && !this.triedEncryptedFallback
        && this.deps.outerPreference() === "auto") {
      this.triedEncryptedFallback = true;
      this.deps.log("device dropped the link before replying to the plain handshake; retrying with the encrypted one");
      this.forcedOuter = "encrypted";
      await this.deps.reconnect();
      return;
    }
    this.render();
  }

  private forcedOuter: OuterName | null = null;

  private chooseOuter(): OuterName {
    const pref = this.deps.outerPreference();
    if (pref !== "auto") return pref;
    if (this.forcedOuter) return this.forcedOuter;
    const cap = this.deps.advertisement()?.capability;
    if (cap != null) return cap & CAPABILITY_ENCRYPTED_ECDH ? "encrypted" : "plain";
    return "plain";
  }

  private async start(outer: OuterName) {
    this.opens = 0;
    this.settledOnce = false;
    this.session = new SolixSession({
      outer,
      write: (frame) => this.writeFrame(frame),
      log: (m) => this.deps.log(`solix: ${m}`),
      onState: (s) => this.onState(s),
      onMessage: (m) => this.onMessage(m),
    });
    this.deps.log(`starting SOLIX handshake (${outer} outer)`);
    this.render();
    await this.open();
  }

  private async open() {
    const s = this.session;
    if (!s) return;
    this.opens++;
    try {
      await s.open();
    } catch (e) {
      this.deps.log(`open failed: ${e instanceof Error ? e.message : e}`, "err");
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      if (this.session !== s || s.state !== "negotiating") return;
      if (s.replied) return; // in progress; the device is talking
      if (this.opens < MAX_OPENS) {
        this.deps.log("no reply to the handshake yet; resending x001");
        void this.open();
      } else if (s.outer === "plain" && this.deps.outerPreference() === "auto" && !this.triedEncryptedFallback) {
        this.triedEncryptedFallback = true;
        this.forcedOuter = "encrypted";
        void this.start("encrypted");
      } else {
        this.deps.log("device never answered the handshake", "err");
        this.settle();
      }
    }, OPEN_RETRY_MS);
  }

  private async writeFrame(frame: Uint8Array) {
    const c = this.write;
    if (!c) throw new Error("not connected");
    const buf = new Uint8Array(frame);
    if (c.properties.write) await c.writeValueWithResponse(buf);
    else await c.writeValueWithoutResponse(buf);
  }

  private onValue = (ev: Event) => {
    const v = (ev.target as BluetoothRemoteGATTCharacteristic).value;
    if (!v || !this.session) return;
    void this.session.handleNotification(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  };

  private onState(state: SessionState) {
    this.render();
    if (state === "authorized") {
      this.deps.log("SOLIX session authorized", "ok");
      if (this.deps.autoSubscribe()) void this.subscribe();
      this.settle();
    } else if (state === "awaiting-confirmation") {
      const w = this.session?.announcement.confirmationWindow;
      this.deps.log(`press the IoT/Bluetooth button on the power station to approve this browser${w ? ` (within ${w}s)` : ""}`, "warn");
    } else if (state === "failed") {
      this.settle();
    }
  }

  private settle() {
    if (this.settledOnce) return;
    this.settledOnce = true;
    this.deps.settled();
  }

  async subscribe() {
    try {
      await this.session?.sendCommand(SUBSCRIBE_CMD, SUBSCRIBE_TAGS);
      this.deps.log(`sent telemetry subscribe (${SUBSCRIBE_CMD})`);
    } catch (e) {
      this.deps.log(`subscribe failed: ${e instanceof Error ? e.message : e}`, "err");
    }
  }

  private onMessage(m: SessionMessage) {
    const prev = this.lastParams.get(m.cmd) ?? new Map<number, string>();
    const rows = [...m.params].map(([k, v]) => {
      const h = hex(v);
      const changed = prev.size > 0 && prev.get(k) !== h;
      return { k, h, changed };
    });
    this.lastParams.set(m.cmd, new Map(rows.map((r) => [r.k, r.h])));

    const table = document.createElement("table");
    table.className = "params";
    const cap = table.createCaption();
    cap.textContent = `cmd ${m.cmd} · ${m.encrypted ? "encrypted" : "clear"} · ${m.params.size} tags · ${new Date().toLocaleTimeString()}`;
    for (const r of rows) {
      const tr = table.insertRow();
      if (r.changed) tr.className = "changed";
      tr.insertCell().textContent = r.k.toString(16);
      tr.insertCell().textContent = r.h;
    }
    let block = document.querySelector<HTMLElement>(`#solixRaw [data-cmd="${m.cmd}"]`);
    if (!block) {
      block = document.createElement("div");
      block.dataset.cmd = m.cmd;
      $("solixRaw").append(block);
    }
    block.replaceChildren(table);
    $("solixRawHint").hidden = true;

    if (m.params.size >= 8) {
      const fields = decodeGen2(m.params);
      if (fields.length) fillKv($("solixDecoded"), fields.map((f) => [f.label, f.value]));
    }
  }

  render() {
    const s = this.session;
    const pill = $("solixState");
    pill.textContent = s ? s.state : "not started";
    pill.className = "pill " + (s?.state === "authorized" ? "ok" : s?.state === "failed" ? "bad" : s?.state === "awaiting-confirmation" ? "warn" : "");
    const a = s?.announcement ?? {};
    const ad = this.deps.advertisement();
    const rows: [string, string][] = [
      ["outer", s?.outer ?? "—"],
      ["serial", a.serial ?? "—"],
      ["MAC", a.mac ?? ad?.mac ?? "—"],
      ["chip / firmware", [a.chip, a.firmware].filter(Boolean).join(" / ") || "—"],
      ["MTU", a.mtu?.toString() ?? "—"],
      ["methods", a.encryptMethod != null ? `base 0x${(a.baseMethod ?? 0).toString(16)} · encrypt 0x${a.encryptMethod.toString(16)} · auth ${a.authMethod ?? "—"}` : "—"],
    ];
    if (ad) rows.push(["advertised", `product ${ad.productType} · sku ${ad.sku} · capability ${ad.capability ?? "—"}`]);
    if (s?.error) rows.push(["error", s.error]);
    fillKv($("solixInfo"), rows);
    ($("solixSubscribe") as HTMLButtonElement).disabled = s?.state !== "authorized";
  }
}
