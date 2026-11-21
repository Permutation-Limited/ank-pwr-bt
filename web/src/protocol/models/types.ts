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
  /** The undecoded number behind ``value`` (e.g. 30 for "30 s", 1 for "on (1)"), when there is one. */
  raw?: number;
  unit?: string;
  role: FieldRole;
  /** Section heading for detailed views, e.g. "Settings". */
  group?: string;
}

/** A session command: ``cmd`` includes flag bits (e.g. "4100"); tags are raw TLV values. */
export interface ModelCommand {
  cmd: string;
  tags: [number, Uint8Array][];
  description: string;
}

/**
 * One value inside a settings command: a TLV tag holding a type byte and a
 * little-endian value (ui 1 byte, sile 2 bytes, var 4 bytes).
 */
export interface SettingField {
  tag: number;
  type: "ui" | "sile" | "var";
  label: string;
  /** Choices (value -> label); when absent, a number between min and max. */
  options?: Record<number, string>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Telemetry field key that reads this setting back, to show the current value. */
  stateKey?: string;
  /** Single-bit flag inside a packed byte: 0/1 is sent as 0/mask (other bits 0). */
  mask?: number;
  /** Initial value when telemetry doesn't provide one. */
  default?: number;
}

/**
 * A settings command (``msgtype`` without flag bits, e.g. 0x101). Every
 * field is sent together in one message, after the ``a1`` header.
 */
export interface SettingSpec {
  id: string;
  label: string;
  group: string;
  msgtype: number;
  fields: SettingField[];
  /** Where the definition comes from and how sure we are, shown in the UI. */
  note?: string;
  /** Proven on real hardware over BLE. */
  verified?: boolean;
  /**
   * A live on/off action rather than a stored setting (e.g. light the screen
   * now). UIs show it as a switch that follows telemetry and sends at once.
   * Only for single-field specs with off (0) / on (1) options.
   */
  toggle?: boolean;
  /**
   * Switches an output port. Status pages list these under "Outputs", with
   * the watts from telemetry field ``powerKey``. Implies ``toggle``.
   */
  output?: { powerKey: string };
  /** Could leave the device in an unwanted state (e.g. AC frequency). */
  caution?: string;
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
  /** Settings this model can change. */
  settings?: readonly SettingSpec[];
  /** Pull a part number out of telemetry, if the model knows where it is. */
  partNumber?(params: Params): string | undefined;
}
