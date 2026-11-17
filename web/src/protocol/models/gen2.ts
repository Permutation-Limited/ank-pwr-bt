// SOLIX Gen 2 power stations (C1000 Gen 2 / C1000X Gen 2 / C1000 Plus /
// C2000 Gen 2). Field map from SolixBLE's devices/c1000g2.py; offsets index
// the tag's raw bytes, type byte included.
//
// Checked live on a C2000 Gen 2 (A1783): encrypted handshake; after the 4100
// subscribe it streams c900, then c421 every ~3 s, with this tag layout.
//
// Beyond SolixBLE, mapped on the C2000:
// - a6[7:9]: time remaining, 0.1 h units. The station's screen showed 2 d 15 h
//   (63 h) while this read 61–67 h; the screen shows a smoothed value.
// - c0: battery pack serial and label ("A1783_2kWh"), length-prefixed ASCII.
// Ports report only status and watts (no per-port voltage or current), unlike
// the Prime chargers' tags.

import { type Params, paramInt } from "../packet";
import type { DeviceModel, FieldRole, TelemetryField } from "./types";

const NAMES = [/^SOLIX C1000X? Gen 2/, /^SOLIX C1000 Plus/, /^SOLIX C2000X? Gen 2/];
const PRODUCT_TYPES = ["b118", "b119"]; // A1763, A1765 (C2000's not yet seen)
const PART_NUMBERS = ["A1763", "A1765", "A1783"];
const TELEMETRY_CMDS = ["c421", "c900"];

const PORT = ["not connected", "output", "input"];
const port = (v: number | undefined) => (v === undefined ? undefined : PORT[v] ?? `unknown (${v})`);
/** Input-only ports report 1 for "active"; SolixBLE maps that to input. */
const inputPort = (v: number | undefined) => port(v === 1 ? 2 : v);

function ascii(p: Params, key: number, begin: number, end: number) {
  const v = p.get(key);
  if (!v) return undefined;
  return new TextDecoder("ascii").decode(v.subarray(begin, end)).replace(/[^\x20-\x7e]/g, "") || undefined;
}

/** ASCII string whose length is the byte at ``lenAt``; undefined if it doesn't fit. */
function lengthPrefixed(p: Params, key: number, lenAt: number) {
  const v = p.get(key);
  const len = v?.[lenAt];
  if (!v || len === undefined || len === 0 || lenAt + 1 + len > v.length) return undefined;
  return ascii(p, key, lenAt + 1, lenAt + 1 + len);
}

/** a6[7:9] in 0.1 h units. */
function hoursRemaining(p: Params) {
  const raw = paramInt(p, 0xa6, 7, 9);
  return raw === undefined || raw === 0 ? undefined : Math.round(raw) / 10;
}

export const gen2: DeviceModel = {
  id: "solix-gen2",
  name: "SOLIX Gen 2 power station",
  preferredOuter: "encrypted",

  matches: ({ name, productType, partNumber }) =>
    (!!name && NAMES.some((re) => re.test(name)))
    || (!!productType && PRODUCT_TYPES.includes(productType))
    || (!!partNumber && PART_NUMBERS.includes(partNumber)),

  // Gen 2 streams nothing until it gets this subscribe command.
  onAuthorized: [{ cmd: "4100", tags: [[0xa1, Uint8Array.of(0x21)]], description: "subscribe to telemetry" }],

  partNumber: (p) => ascii(p, 0xa2, 22, 27),

  decodeTelemetry(cmd, p) {
    if (!TELEMETRY_CMDS.includes(cmd)) return [];
    const rows: [string, string, FieldRole, number | string | undefined, string?][] = [
      ["serial", "Serial number", "info", ascii(p, 0xa2, 3, 20)],
      ["part_number", "Part number", "info", ascii(p, 0xa2, 22, 27)],
      ["battery_percent", "Battery", "battery", paramInt(p, 0xa5, 3, 4), "%"],
      // C1000 Gen 2's battery health byte (a5[4]) read 232 on a C2000; omitted.
      ["temperature", "Temperature", "temperature", paramInt(p, 0xa5, 1, 2, true), "°C"],
      ["time_remaining", "Time remaining", "time_remaining", hoursRemaining(p), "h"],
      ["battery_pack_serial", "Battery pack serial", "info", lengthPrefixed(p, 0xc0, 1)],
      ["battery_pack", "Battery pack", "info", lengthPrefixed(p, 0xc0, 33)],
      ["power_out", "Total output", "output_total", paramInt(p, 0xa6, 1, 3), "W"],
      ["ac_in", "AC", "input", paramInt(p, 0xa6, 3, 5), "W"],
      ["solar_in", "Solar", "input", paramInt(p, 0xa8, 2), "W"],
      ["ac_out", "AC", "output", paramInt(p, 0xa7, 2, 4), "W"],
      ["usb_c1", "USB-C1", "output", paramInt(p, 0xaa, 2), "W"],
      ["usb_c2", "USB-C2", "output", paramInt(p, 0xab, 2), "W"],
      ["usb_c3", "USB-C3", "output", paramInt(p, 0xac, 2), "W"],
      ["usb_a1", "USB-A", "output", paramInt(p, 0xae, 2), "W"],
      ["dc_out", "Car / DC", "output", paramInt(p, 0xb2, 2), "W"],
      ["ac_port", "AC port", "port", port(paramInt(p, 0xa7, 1, 2))],
      ["solar_port", "Solar port", "port", inputPort(paramInt(p, 0xa8, 1, 2))],
      ["dc_port", "DC port", "port", port(paramInt(p, 0xb2, 1, 2))],
      ["max_charge", "Max charge limit", "setting", paramInt(p, 0xd9, 4, 5), "%"],
      ["min_discharge", "Min discharge limit", "setting", paramInt(p, 0xd9, 5, 6), "%"],
    ];
    return rows
      .filter(([, , , v]) => v !== undefined)
      .map(([key, label, role, value, unit]): TelemetryField => ({ key, label, role, value: value!, unit }));
  },
};
