// Settings commands. Gen 2 stations take the same messages over BLE that
// Anker's cloud sends over MQTT: BLE command = 0x4000 (encrypted) | the MQTT
// message type, so MQTT 0101 is BLE 4101, just as telemetry 0421 arrives as
// c421. Payload: a1 = 0x21 header, the setting tags, then a timestamp.
//
// Encoding checked against SolixBLE's C1000 Gen 2 AC switch
// (tests/devices/c1000g2.py): 4101 a1 01 21 | a2 02 01 01 | fe 05 03 <u32 s>.
// anker-solix-api's MQTT commands use a1 = 0x22 and, for "V2" commands, a
// millisecond ASCII timestamp in fd; both are selectable in the debug UI.

import { u16le, u32le, u8 } from "./bytes";
import type { ModelCommand, SettingField, SettingSpec } from "./models/types";

/** How a command is timestamped: fe = u32 seconds (SolixBLE), fd = ms as ASCII (MQTT V2), none. */
export type TimestampStyle = "fe" | "fd" | "none";

export interface CommandOptions {
  /** First-tag header byte; 0x21 over BLE (SolixBLE), 0x22 in MQTT. */
  header?: number;
}

const TYPE_BYTE = { ui: 0x01, sile: 0x02, var: 0x03 } as const;

/** A tag value: type byte + little-endian integer. */
export function encodeSettingValue(type: SettingField["type"], value: number): Uint8Array {
  const body = type === "ui" ? u8(value) : type === "sile" ? u16le(value) : u32le(value);
  return Uint8Array.of(TYPE_BYTE[type], ...body);
}

/** BLE command (hex, flags included) for an MQTT-style message type. */
export const settingCmd = (msgtype: number) => (0x4000 | (msgtype & 0x0fff)).toString(16).padStart(4, "0");

/** Build the command for ``spec`` with one value per field (in field order). */
export function buildSettingCommand(spec: SettingSpec, values: number[], opts: CommandOptions = {}): ModelCommand {
  if (values.length !== spec.fields.length) throw new Error(`${spec.id}: expected ${spec.fields.length} values`);
  const tags: [number, Uint8Array][] = [[0xa1, u8(opts.header ?? 0x21)]];
  spec.fields.forEach((f, i) => {
    const v = values[i]!;
    if (!Number.isInteger(v)) throw new Error(`${f.label}: not an integer`);
    if (f.options && !(v in f.options)) throw new Error(`${f.label}: ${v} is not one of the options`);
    if (f.min !== undefined && v < f.min) throw new Error(`${f.label}: below ${f.min}`);
    if (f.max !== undefined && v > f.max) throw new Error(`${f.label}: above ${f.max}`);
    tags.push([f.tag, encodeSettingValue(f.type, f.mask ? (v ? f.mask : 0) : v)]);
  });
  const desc = spec.fields.map((f, i) => `${f.label}=${f.options?.[values[i]!] ?? values[i]}`).join(", ");
  return { cmd: settingCmd(spec.msgtype), tags, description: `${spec.label}: ${desc}` };
}
