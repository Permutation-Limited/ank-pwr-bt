// Web Bluetooth client for SOLIX devices. Owns the BluetoothDevice, the GATT
// connection, the protocol session and the retry/fallback policy, and reports
// everything through typed events. No DOM: any UI can sit on top.

import {
  type AnkerRecord, type Announcement, CAPABILITY_ENCRYPTED_ECDH, type CommandOptions, type DeviceModel,
  KNOWN_PRODUCT_TYPES, type OuterName, type Params, type SessionState, type SettingSpec, SolixSession,
  type TelemetryField, type TimestampStyle, buildSettingCommand, hex, parseAnkerRecord, resolveModel,
} from "../protocol";
import { Emitter, errMsg } from "./emitter";
import { exploreGatt, type ServiceInfo } from "./gatt-explorer";
import {
  ANKER_COMPANY_ID, DEFAULT_OPTIONAL_SERVICES, SOLIX_COMMAND, SOLIX_GATT_CANDIDATES, SOLIX_SERVICES,
  SOLIX_TELEMETRY,
} from "./uuids";

const OPEN_RETRY_MS = 8000;
const MAX_OPENS = 3;

export type LogLevel = "info" | "ok" | "warn" | "err";
export type OuterPreference = "auto" | OuterName;

export interface ClientSettings {
  /** Handshake variant; "auto" uses advertisement, then model hint, then plain with encrypted fallback. */
  outer: OuterPreference;
  /** Send the model's post-authorization commands (e.g. telemetry subscribe). */
  runModelCommands: boolean;
}

export interface DeviceFilter {
  /** Show every nearby device instead of only Anker ones. */
  acceptAll: boolean;
  extraServices: BluetoothServiceUUID[];
  manufacturerIds: number[];
}

export interface ConnectionSnapshot {
  device: { id: string; name?: string } | null;
  connected: boolean;
  watchingAdvertisements?: boolean;
}

export interface SessionSnapshot {
  state: SessionState | "not-started" | "unsupported";
  outer?: OuterName;
  model: { id: string; name: string };
  announcement: Announcement;
  error?: string;
}

export interface TelemetryEvent {
  at: Date;
  cmd: string;
  encrypted: boolean;
  params: Params;
  fields: TelemetryField[];
}

export interface AdvertisementInfo {
  at: Date;
  name?: string;
  rssi?: number;
  txPower?: number;
  appearance?: number;
  uuids: string[];
  manufacturerData: { companyId: number; bytes: Uint8Array }[];
  serviceData: { uuid: string; bytes: Uint8Array }[];
  anker?: AnkerRecord & { productName?: string };
}

export interface ClientEvents extends Record<string, unknown> {
  log: { message: string; level: LogLevel };
  connection: ConnectionSnapshot;
  session: SessionSnapshot;
  telemetry: TelemetryEvent;
  advertisement: AdvertisementInfo;
  /** The handshake reached a final state (authorized, failed, gave up), or the device isn't SOLIX. */
  settled: { authorized: boolean };
  /** watchAdvertisements() isn't available. */
  advertisementsUnsupported: { reason: string };
}

const bytesOf = (v: DataView) => new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));

export function buildRequestOptions(filter: DeviceFilter): RequestDeviceOptions {
  const opts: RequestDeviceOptions = {
    optionalServices: [...DEFAULT_OPTIONAL_SERVICES, ...filter.extraServices],
    optionalManufacturerData: [ANKER_COMPANY_ID, ...filter.manufacturerIds],
  };
  if (filter.acceptAll) {
    opts.acceptAllDevices = true;
  } else {
    // SolixBLE's discover_devices() rule: the Anker manufacturer record
    // (company 0xffff) or a SOLIX transport service; names as a backstop.
    opts.filters = [
      { manufacturerData: [{ companyIdentifier: ANKER_COMPANY_ID }] },
      ...SOLIX_SERVICES.map((s) => ({ services: [s] })),
      { namePrefix: "Anker" },
      { namePrefix: "SOLIX" },
    ];
  }
  return opts;
}

export class SolixClient extends Emitter<ClientEvents> {
  settings: ClientSettings = { outer: "auto", runModelCommands: true };

  private device: BluetoothDevice | null = null;
  private advAbort: AbortController | null = null;
  private anker: AnkerRecord | null = null;
  private model: DeviceModel = resolveModel({});
  private session: SolixSession | null = null;
  private write: BluetoothRemoteGATTCharacteristic | null = null;
  private notify: BluetoothRemoteGATTCharacteristic | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private opens = 0;
  private forcedOuter: OuterName | null = null;
  private settledOnce = false;
  private userDisconnect = false;
  private isSolix = false;

  // ---------------------------------------------------------------- public API

  get hasDevice() { return !!this.device; }
  get connected() { return !!this.device?.gatt?.connected; }
  get authorized() { return this.session?.state === "authorized"; }

  /** Show the browser's device picker; resolves false if the user cancels. */
  async requestDevice(filter: DeviceFilter): Promise<boolean> {
    const opts = buildRequestOptions(filter);
    this.log(`requestDevice(${JSON.stringify(opts)})`);
    let device: BluetoothDevice;
    try {
      device = await navigator.bluetooth!.requestDevice(opts);
    } catch (e) {
      this.log(errMsg(e), "err");
      return false;
    }
    this.adopt(device);
    return true;
  }

  /** Connect GATT and, for SOLIX devices, run the handshake. */
  async connect(): Promise<void> {
    const gatt = this.device?.gatt;
    if (!gatt) return;
    this.userDisconnect = false;
    await this.watchAdvertisements();
    try {
      this.log("gatt.connect()…");
      await gatt.connect();
      this.log("connected");
    } catch (e) {
      this.log(errMsg(e), "err");
    }
    this.emitConnection();
    if (!gatt.connected) return;
    try {
      this.isSolix = await this.attachSolix();
    } catch (e) {
      this.log(`SOLIX setup: ${errMsg(e)}`, "err");
      this.isSolix = false;
    }
    if (!this.isSolix) {
      this.emitSession("unsupported");
      this.settle(false);
    }
  }

  disconnect() {
    this.userDisconnect = true;
    this.detachSolix();
    this.session = null;
    this.advAbort?.abort();
    this.device?.gatt?.disconnect();
    this.emitConnection();
    this.emitSession();
  }

  /** Send a raw session command, e.g. ("4100", [[0xa1, Uint8Array.of(0x21)]]). */
  async sendCommand(cmd: string, tags: [number, Uint8Array][], timestamp: TimestampStyle = "fe") {
    if (!this.session) throw new Error("no session");
    await this.session.sendCommand(cmd, tags, timestamp);
  }

  /** Settings the current model can change. */
  get settingSpecs(): readonly SettingSpec[] { return this.model.settings ?? []; }

  /** Send one settings command; values are in the spec's field order. */
  async sendSetting(spec: SettingSpec, values: number[], opts: CommandOptions & { timestamp?: TimestampStyle } = {}) {
    const c = buildSettingCommand(spec, values, opts);
    await this.sendCommand(c.cmd, c.tags, opts.timestamp);
    this.log(`sent ${c.description} (${c.cmd})`, "ok");
  }

  /** Send the resolved model's post-authorization commands. */
  async runModelCommands() {
    for (const c of this.model.onAuthorized) {
      try {
        await this.sendCommand(c.cmd, c.tags);
        this.log(`sent ${c.description} (${c.cmd})`);
      } catch (e) {
        this.log(`${c.description} failed: ${errMsg(e)}`, "err");
      }
    }
  }

  /** Commands the current model sends after authorization (for display). */
  get modelCommands() { return this.model.onAuthorized; }

  /** Enumerate the accessible GATT tree. Throws if nothing is accessible. */
  async exploreGatt(): Promise<ServiceInfo[]> {
    if (!this.device?.gatt?.connected) throw new Error("not connected");
    const services = await exploreGatt(this.device.gatt);
    this.log(`found ${services.length} accessible primary service(s)`);
    return services;
  }

  // ---------------------------------------------------------------- device lifecycle

  private adopt(device: BluetoothDevice) {
    this.detachSolix();
    this.device = device;
    this.anker = null;
    this.forcedOuter = null;
    this.model = resolveModel({ name: device.name });
    device.addEventListener("gattserverdisconnected", () => void this.onDisconnected());
    this.log(`selected ${device.name ?? "(unnamed)"} [${device.id}] → model: ${this.model.name}`);
    this.emitConnection();
    this.emitSession();
  }

  private async onDisconnected() {
    this.log("gattserverdisconnected");
    clearTimeout(this.retryTimer);
    this.emitConnection();
    const s = this.session;
    if (!this.userDisconnect && s && !s.replied && s.outer === "plain"
        && this.settings.outer === "auto" && this.forcedOuter !== "encrypted") {
      this.forcedOuter = "encrypted";
      this.log("device dropped the link before replying to the plain handshake; retrying with the encrypted one", "warn");
      await this.connect();
      return;
    }
    this.emitSession();
  }

  private async watchAdvertisements() {
    const d = this.device;
    if (!d?.watchAdvertisements) {
      this.emit("advertisementsUnsupported", { reason: "watchAdvertisements() not supported in this browser" });
      return;
    }
    this.advAbort?.abort();
    this.advAbort = new AbortController();
    d.addEventListener("advertisementreceived", (ev) => this.onAdvertisement(ev as BluetoothAdvertisingEvent),
      { signal: this.advAbort.signal });
    try {
      await d.watchAdvertisements({ signal: this.advAbort.signal });
      this.log("watching advertisements");
    } catch (e) {
      this.log(`watchAdvertisements: ${errMsg(e)}`, "err");
    }
  }

  private onAdvertisement(e: BluetoothAdvertisingEvent) {
    const info: AdvertisementInfo = {
      at: new Date(), name: e.name, rssi: e.rssi, txPower: e.txPower, appearance: e.appearance,
      uuids: e.uuids, manufacturerData: [], serviceData: [],
    };
    e.manufacturerData.forEach((v, companyId) => {
      info.manufacturerData.push({ companyId, bytes: bytesOf(v) });
      if (companyId !== ANKER_COMPANY_ID) return;
      const rec = parseAnkerRecord(v);
      if (!rec) return;
      this.anker = rec;
      info.anker = { ...rec, productName: KNOWN_PRODUCT_TYPES[rec.productType] };
      const model = resolveModel({ name: this.device?.name, productType: rec.productType });
      if (model.id !== this.model.id && !this.session) this.model = model;
    });
    e.serviceData.forEach((v, uuid) => info.serviceData.push({ uuid, bytes: bytesOf(v) }));
    this.emit("advertisement", info);
  }

  // ---------------------------------------------------------------- SOLIX session

  private async attachSolix(): Promise<boolean> {
    this.detachSolix();
    const gatt = this.device!.gatt!;
    let found: [BluetoothRemoteGATTCharacteristic, BluetoothRemoteGATTCharacteristic] | null = null;
    for (const uuid of SOLIX_GATT_CANDIDATES) {
      try {
        const service = await gatt.getPrimaryService(uuid);
        found = [await service.getCharacteristic(SOLIX_COMMAND), await service.getCharacteristic(SOLIX_TELEMETRY)];
        this.log(`SOLIX characteristics found in service ${uuid}`);
        break;
      } catch (e) {
        this.log(`service ${uuid}: ${errMsg(e)}`);
      }
    }
    if (!found) {
      this.log("no SOLIX command/telemetry characteristics found; not a supported SOLIX transport", "warn");
      return false;
    }
    [this.write, this.notify] = found;
    this.notify.addEventListener("characteristicvaluechanged", this.onValue);
    await this.notify.startNotifications();
    await this.startSession(this.chooseOuter());
    return true;
  }

  private detachSolix() {
    clearTimeout(this.retryTimer);
    this.notify?.removeEventListener("characteristicvaluechanged", this.onValue);
    this.notify = null;
    this.write = null;
  }

  private chooseOuter(): OuterName {
    if (this.settings.outer !== "auto") return this.settings.outer;
    if (this.forcedOuter) return this.forcedOuter;
    const cap = this.anker?.capability;
    if (cap != null) return cap & CAPABILITY_ENCRYPTED_ECDH ? "encrypted" : "plain";
    return this.model.preferredOuter ?? "plain";
  }

  private async startSession(outer: OuterName) {
    this.opens = 0;
    this.settledOnce = false;
    this.session = new SolixSession({
      outer,
      write: (frame) => this.writeFrame(frame),
      log: (m) => this.log(`solix: ${m}`),
      onState: (s) => this.onSessionState(s),
      onMessage: (m) => this.onSessionMessage(m.cmd, m.encrypted, m.params, m.status),
    });
    this.log(`starting SOLIX handshake (${outer} outer, model: ${this.model.name})`);
    this.emitSession();
    await this.openSession();
  }

  private async openSession() {
    const s = this.session;
    if (!s) return;
    this.opens++;
    try {
      await s.open();
    } catch (e) {
      this.log(`open failed: ${errMsg(e)}`, "err");
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.session !== s || s.state !== "negotiating" || s.replied) return;
      if (this.opens < MAX_OPENS) {
        this.log("no reply to the handshake yet; resending x001");
        void this.openSession();
      } else if (s.outer === "plain" && this.settings.outer === "auto" && this.forcedOuter !== "encrypted") {
        this.forcedOuter = "encrypted";
        void this.startSession("encrypted");
      } else {
        this.log("device never answered the handshake", "err");
        this.settle(false);
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
    if (v && this.session) void this.session.handleNotification(bytesOf(v));
  };

  private onSessionState(state: SessionState) {
    this.emitSession();
    if (state === "authorized") {
      this.log("SOLIX session authorized", "ok");
      if (this.settings.runModelCommands) void this.runModelCommands();
      this.settle(true);
    } else if (state === "awaiting-confirmation") {
      const w = this.session?.announcement.confirmationWindow;
      this.log(`approve this browser on the power station (short-press its IoT or power button)${w ? ` within ${w}s` : ""}`, "warn");
    } else if (state === "failed") {
      this.settle(false);
    }
  }

  private onSessionMessage(cmd: string, encrypted: boolean, params: Params, status: number | null) {
    // Replies to our commands lead with a status byte; telemetry pushes don't.
    if (status !== null) {
      // Short replies (setting acks) in full; telemetry-sized ones (c900) as a tag count.
      const all = [...params].map(([k, v]) => `${k.toString(16)}=${hex(v)}`).join(" ");
      const tags = all.length <= 80 ? all : `${params.size} tags`;
      this.log(`reply ${cmd} status 0x${status.toString(16).padStart(2, "0")}${tags ? ` ${tags}` : ""}`,
        status === 0 ? "ok" : "warn");
    }
    // Telemetry may reveal the exact model (part number) on generic devices.
    const part = this.model.partNumber?.(params);
    if (part) {
      const better = resolveModel({ name: this.device?.name, productType: this.anker?.productType, partNumber: part });
      if (better.id !== this.model.id) {
        this.model = better;
        this.log(`model identified from telemetry: ${better.name} (${part})`, "ok");
        this.emitSession();
      }
    }
    this.emit("telemetry", { at: new Date(), cmd, encrypted, params, fields: this.model.decodeTelemetry(cmd, params) });
  }

  private settle(authorized: boolean) {
    if (this.settledOnce) return;
    this.settledOnce = true;
    this.emit("settled", { authorized });
  }

  // ---------------------------------------------------------------- events

  private log(message: string, level: LogLevel = "info") {
    this.emit("log", { message, level });
  }

  private emitConnection() {
    this.emit("connection", {
      device: this.device ? { id: this.device.id, name: this.device.name } : null,
      connected: this.connected,
      watchingAdvertisements: this.device?.watchingAdvertisements,
    });
  }

  private emitSession(override?: SessionSnapshot["state"]) {
    const s = this.session;
    this.emit("session", {
      state: override ?? s?.state ?? "not-started",
      outer: s?.outer,
      model: { id: this.model.id, name: this.model.name },
      announcement: { ...(s?.announcement ?? {}) },
      error: s?.error,
    });
  }
}
