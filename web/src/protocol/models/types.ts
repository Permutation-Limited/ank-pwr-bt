// Device model abstraction. Everything model-specific lives behind this
// interface; the session, BLE client and UI only ever talk to a DeviceModel.

import type { OuterName } from "../crypto";
import type { Params } from "../packet";

/** What is known about a device before or while connecting. */
export interface DeviceHints {
  /** Advertised local name, e.g. "SOLIX C2000 Gen 2". */
  name?: string;
  /** Anker advertisement record product type (hex), e.g. "b118". */
  productType?: string;
  /** Part number from telemetry, e.g. "A1783". */
  partNumber?: string;
}

/**
 * What a field means, so UIs can lay out any model's telemetry without
 * knowing the model:
 * - battery: state of charge (%)
 * - expansion_battery: an expansion pack's state of charge (%)
 * - input / output: power on one port (W)
 * - input_total / output_total: power summed across ports (W)
 * - time_remaining: hours until empty (discharging) or full (charging)
 * - temperature, port, setting, info: everything else
 */
export type FieldRole =
  | "battery" | "expansion_battery" | "input" | "output" | "input_total" | "output_total" | "time_remaining"
  | "temperature" | "port" | "setting" | "info";

/** One decoded telemetry value, ready to display. */
export interface TelemetryField {
  key: string; // stable id, e.g. "battery_percent"
  label: string; // human label, e.g. "Battery"
  value: number | string;
  unit?: string;
  role: FieldRole;
}

/** A session command: ``cmd`` includes flag bits (e.g. "4100"); tags are raw TLV values. */
export interface ModelCommand {
  cmd: string;
  tags: [number, Uint8Array][];
  description: string;
}

export interface DeviceModel {
  /** Stable identifier, e.g. "solix-gen2". */
  id: string;
  /** Display name, e.g. "SOLIX Gen 2 power station". */
  name: string;
  /** True if this model handles a device with these hints. */
  matches(hints: DeviceHints): boolean;
  /** Handshake variant to try first when the advertisement gives no hint. */
  preferredOuter?: OuterName;
  /** Commands to send once the session is authorized (e.g. start telemetry). */
  onAuthorized: ModelCommand[];
  /** Decode a telemetry message; return [] if it isn't one this model knows. */
  decodeTelemetry(cmd: string, params: Params): TelemetryField[];
  /** Pull a part number out of telemetry, if the model knows where it is. */
  partNumber?(params: Params): string | undefined;
}
