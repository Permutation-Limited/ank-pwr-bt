// UI state: subscribes to the SolixClient's events and keeps an immutable
// snapshot that React components read through useAppState().

import { createContext, useContext, useSyncExternalStore } from "react";
import {
  type AdvertisementInfo, type BluetoothEnvironment, type ConnectionSnapshot, type LogLevel,
  type OuterPreference, type ServiceInfo, type SessionSnapshot, type SolixClient, type TelemetryEvent,
  bluetoothEnvironment, errMsg, hex, onAvailabilityChanged, parseServiceUuid,
} from "../ble";

export interface LogEntry { id: number; at: Date; message: string; level: LogLevel }

/** Latest frame per telemetry command, with the previous tag values for change marking. */
export interface RawFrame {
  cmd: string;
  encrypted: boolean;
  at: Date;
  tags: [number, string][];
  previous: Map<number, string> | null;
}

export type GattState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; services: ServiceInfo[] }
  | { status: "error"; error: string };

export interface ConnectOptions {
  acceptAll: boolean;
  outer: OuterPreference;
  runModelCommands: boolean;
  autoGatt: boolean;
  extraServices: string;
  manufacturerIds: string;
}

export interface AppState {
  connection: ConnectionSnapshot;
  session: SessionSnapshot | null;
  /** Last telemetry message that decoded to fields; cleared on disconnect. */
  telemetry: TelemetryEvent | null;
  raw: Record<string, RawFrame>;
  advertisement: AdvertisementInfo | null;
  advertisementsUnsupported: string | null;
  environment: BluetoothEnvironment | null;
  log: LogEntry[];
  gatt: GattState;
  options: ConnectOptions;
}

const MAX_LOG = 500;

export class AppStore {
  private state: AppState = {
    connection: { device: null, connected: false },
    session: null,
    telemetry: null,
    raw: {},
    advertisement: null,
    advertisementsUnsupported: null,
    environment: null,
    log: [],
    gatt: { status: "idle" },
    options: {
      acceptAll: false, outer: "auto", runModelCommands: true, autoGatt: false,
      extraServices: "", manufacturerIds: "",
    },
  };
  private listeners = new Set<() => void>();
  private logId = 0;

  constructor(readonly client: SolixClient) {
    client.on("log", ({ message, level }) => this.log(message, level));
    client.on("connection", (connection) =>
      this.set({ connection, ...(connection.connected ? {} : { telemetry: null }) }));
    client.on("session", (session) => this.set({ session }));
    client.on("advertisement", (advertisement) => this.set({ advertisement }));
    client.on("advertisementsUnsupported", ({ reason }) => this.set({ advertisementsUnsupported: reason }));
    client.on("telemetry", (t) => this.onTelemetry(t));
    client.on("settled", () => {
      if (this.state.options.autoGatt || !client.authorized) void this.exploreGatt();
    });
    onAvailabilityChanged(() => void this.refreshEnvironment());
    void this.refreshEnvironment();
  }

  // ------------------------------------------------------------ React glue

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ------------------------------------------------------------ actions

  setOptions(patch: Partial<ConnectOptions>) {
    this.set({ options: { ...this.state.options, ...patch } });
  }

  async connect() {
    const o = this.state.options;
    this.client.settings = { outer: o.outer, runModelCommands: o.runModelCommands };
    const filter = {
      acceptAll: o.acceptAll,
      extraServices: o.extraServices.split(/[\n,]/).map(parseServiceUuid)
        .filter((x): x is BluetoothServiceUUID => x !== null),
      manufacturerIds: o.manufacturerIds.split(",").map((s) => s.trim()).filter(Boolean).map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff),
    };
    if (await this.client.requestDevice(filter)) {
      this.set({ raw: {}, advertisement: null, gatt: { status: "idle" } });
      await this.client.connect();
      await this.refreshEnvironment();
    }
  }

  disconnect() {
    this.client.disconnect();
  }

  async exploreGatt() {
    this.set({ gatt: { status: "loading" } });
    try {
      this.set({ gatt: { status: "ready", services: await this.client.exploreGatt() } });
    } catch (e) {
      this.log(`getPrimaryServices: ${errMsg(e)}`, "err");
      this.set({ gatt: { status: "error", error: errMsg(e) } });
    }
  }

  async refreshEnvironment() {
    this.set({ environment: await bluetoothEnvironment() });
  }

  log(message: string, level: LogLevel = "info") {
    (level === "err" ? console.error : console.log)(message);
    const entry = { id: ++this.logId, at: new Date(), message, level };
    this.set({ log: [...this.state.log.slice(-(MAX_LOG - 1)), entry] });
  }

  clearLog() {
    this.set({ log: [] });
  }

  private onTelemetry(t: TelemetryEvent) {
    const before = this.state.raw[t.cmd];
    const frame: RawFrame = {
      cmd: t.cmd,
      encrypted: t.encrypted,
      at: t.at,
      tags: [...t.params].map(([k, v]) => [k, hex(v)]),
      previous: before ? new Map(before.tags) : null,
    };
    this.set({
      raw: { ...this.state.raw, [t.cmd]: frame },
      ...(t.fields.length ? { telemetry: t } : {}),
    });
  }
}

export const StoreContext = createContext<AppStore | null>(null);

export function useStore(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext missing");
  return store;
}

export function useAppState(): AppState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}
