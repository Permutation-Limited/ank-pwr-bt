// SOLIX C1000 Gen 2 family (C1000 Gen 2 / C1000X Gen 2 / C1000 Plus). Field
// map from SolixBLE's devices/c1000g2.py; offsets index the tag's raw bytes,
// type byte included. The C2000 Gen 2 has its own, fuller map (c2000g2.ts)
// but shares the Gen 2 connection behaviour exported here.
//
// Gen 2 stations take the encrypted handshake; after the 4100 subscribe they
// stream c900, then c421 every ~3 s.
//
// Mapped on a C2000 Gen 2 before its own map existed (layout shared):
// - a6[7:9]: time remaining, 0.1 h units. The station's screen showed 2 d 15 h
//   (63 h) while this read 61–67 h; the screen shows a smoothed value.
// - c0: expansion battery. [1] length + serial (ASCII), [26] charge % (read
//   92 when the user's expansion pack was at 92%, and stepped 93 → 92 while
//   discharging), [33] length + model label ("A1783_2kWh"). Its layout mirrors
//   the main battery's a5: [24] ↔ a5[1] temperature (unverified), [27] ↔ a5[4]
//   (both 232, unknown).
// - a6[5:7]: an input-power total. It tracked solar watts exactly (90-102 W,
//   r = 1.00) with AC in at 0; whether it also counts AC input is unverified.
// Ports report only status and watts (no per-port voltage or current), unlike
// the Prime chargers' tags.

import { type Params, paramInt } from "../packet";
import type { DeviceModel, FieldRole, ModelCommand, TelemetryField } from "./types";

const NAMES = [/^SOLIX C1000X? Gen 2/, /^SOLIX C1000 Plus/];
const PRODUCT_TYPES = ["b118", "b119"]; // A1763, A1765
const PART_NUMBERS = ["A1763", "A1765"];

/** Commands that carry Gen 2 telemetry. */
export const GEN2_TELEMETRY_CMDS = ["c421", "c900"];

/** Gen 2 stations stream nothing until they get this subscribe command. */
export const GEN2_ON_AUTHORIZED: ModelCommand[] = [
  { cmd: "4100", tags: [[0xa1, Uint8Array.of(0x21)]], description: "subscribe to telemetry" },
];

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

type Row = [string, string, FieldRole, number | string | undefined, string?];

/** Expansion battery fields from c0; none if no expansion pack is reported. */
function expansionRows(p: Params): Row[] {
  const serial = lengthPrefixed(p, 0xc0, 1);
  if (!serial) return [];
  return [
    ["expansion_battery_percent", "Expansion battery", "expansion_battery", paramInt(p, 0xc0, 26, 27), "%"],
    ["expansion_temperature", "Expansion temperature (unverified)", "info", paramInt(p, 0xc0, 24, 25, true), "°C"],
    ["expansion_serial", "Expansion battery serial", "info", serial],
    ["expansion_model", "Expansion battery model", "info", lengthPrefixed(p, 0xc0, 33)],
  ];
}

/** a6[7:9] in 0.1 h units. */
function hoursRemaining(p: Params) {
  const raw = paramInt(p, 0xa6, 7, 9);
  return raw === undefined || raw === 0 ? undefined : Math.round(raw) / 10;
}

export const gen2: DeviceModel = {
  id: "solix-gen2",
  name: "SOLIX C1000 Gen 2",
  preferredOuter: "encrypted",

  matches: ({ name, productType, partNumber }) =>
    (!!name && NAMES.some((re) => re.test(name)))
    || (!!productType && PRODUCT_TYPES.includes(productType))
    || (!!partNumber && PART_NUMBERS.includes(partNumber)),

  onAuthorized: GEN2_ON_AUTHORIZED,

  partNumber: (p) => ascii(p, 0xa2, 22, 27),

  decodeTelemetry(cmd, p) {
    if (!GEN2_TELEMETRY_CMDS.includes(cmd)) return [];
    const rows: Row[] = [
      ["serial", "Serial number", "info", ascii(p, 0xa2, 3, 20)],
      ["part_number", "Part number", "info", ascii(p, 0xa2, 22, 27)],
      ["battery_percent", "Main battery", "battery", paramInt(p, 0xa5, 3, 4), "%"],
      // C1000 Gen 2's battery health byte (a5[4]) read 232 on a C2000; omitted.
      ["temperature", "Temperature", "temperature", paramInt(p, 0xa5, 1, 2, true), "°C"],
      ["time_remaining", "Time remaining", "time_remaining", hoursRemaining(p), "h"],
      ...expansionRows(p),
      ["power_out", "Total output", "output_total", paramInt(p, 0xa6, 1, 3), "W"],
      ["ac_in", "AC", "input", paramInt(p, 0xa6, 3, 5), "W"],
      ["input_power_a6", "Input total (unverified)", "info", paramInt(p, 0xa6, 5, 7), "W"],
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
