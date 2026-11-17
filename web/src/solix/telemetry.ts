// Telemetry field map. The C2000 is not yet mapped by any community project,
// so this starts from SolixBLE's C1000 Gen 2 map (devices/c1000g2.py), the
// closest relative. Offsets index the tag's raw bytes, type byte included.
// Treat values as guesses until checked against the Anker app.

import { type Params, paramInt } from "./packet";

/** Gen 2 stations stream nothing until they get this subscribe command. */
export const SUBSCRIBE_CMD = "4100";
export const SUBSCRIBE_TAGS: [number, Uint8Array][] = [[0xa1, Uint8Array.of(0x21)]];

/** Command codes the C1000 Gen 2 pushes telemetry on. */
export const GEN2_TELEMETRY_CMDS = ["c421", "c900"];

const PORT = ["not connected", "output", "input"];

export interface Field { label: string; value: string }

function str(p: Params, key: number, begin: number, end: number) {
  const v = p.get(key);
  return v ? new TextDecoder("ascii").decode(v.subarray(begin, end)).replace(/[^\x20-\x7e]/g, "") : undefined;
}

export function decodeGen2(p: Params): Field[] {
  const rows: [string, string | number | undefined, string?][] = [
    ["Serial number", str(p, 0xa2, 3, 20)],
    ["Part number", str(p, 0xa2, 22, 27)],
    ["Battery", paramInt(p, 0xa5, 3, 4), "%"],
    ["Battery health", paramInt(p, 0xa5, 4, 5), "%"],
    ["Temperature", paramInt(p, 0xa5, 1, 2, true), "°C"],
    ["Total output", paramInt(p, 0xa6, 1, 3), "W"],
    ["AC input", paramInt(p, 0xa6, 3, 5), "W"],
    ["AC output", paramInt(p, 0xa7, 2, 4), "W"],
    ["AC port", portName(paramInt(p, 0xa7, 1, 2))],
    ["Solar input", paramInt(p, 0xa8, 2), "W"],
    ["Solar port", portName(paramInt(p, 0xa8, 1, 2))],
    ["USB-C1", paramInt(p, 0xaa, 2), "W"],
    ["USB-C2", paramInt(p, 0xab, 2), "W"],
    ["USB-C3", paramInt(p, 0xac, 2), "W"],
    ["USB-A1", paramInt(p, 0xae, 2), "W"],
    ["DC output", paramInt(p, 0xb2, 2), "W"],
    ["DC port", portName(paramInt(p, 0xb2, 1, 2))],
    ["Max charge limit", paramInt(p, 0xd9, 4, 5), "%"],
    ["Min discharge limit", paramInt(p, 0xd9, 5, 6), "%"],
  ];
  return rows
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([label, v, unit]) => ({ label, value: `${v}${unit ? " " + unit : ""}` }));
}

function portName(v: number | undefined) {
  return v === undefined ? undefined : PORT[v] ?? `unknown (${v})`;
}
