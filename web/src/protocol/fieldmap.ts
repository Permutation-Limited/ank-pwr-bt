// Table-driven telemetry decoding.
//
// A tag's value starts with a type byte; the layouts below index the bytes
// *after* it, matching anker-solix-api's mqttmap.py so maps port over as-is:
//   ui      1 byte, unsigned (signed: true for signed)
//   sile    2 bytes little-endian, signed unless signed: false
//   var     `length` (default 4) bytes little-endian, signed unless signed: false
//   str     a length byte, then that many ASCII bytes
//   version 4 bytes, printed most-significant first (02 02 09 01 -> 1.9.2.2)
// `mask` picks bits out of a ui byte. A tag is either positional (each field
// has `at`) or sequential (fields follow one another, `skip` jumps bytes),
// the latter for layouts whose offsets depend on string lengths.

import type { Params } from "./packet";
import type { FieldRole, TelemetryField } from "./models/types";

export type FieldType = "ui" | "sile" | "var" | "str" | "version";

/** How to present a number. */
export type FieldFormat =
  | "minutes_of_day" // 480 -> "08:00"
  | "weekdays" // bitmask, bit 0 = Monday ... bit 6 = Sunday
  | "timestamp" // Unix seconds; 0 = none, 0xFFFFFFFF = ongoing
  | "seconds"; // a duration; 0 = disabled

export interface FieldSpec {
  key: string; // stable id; anker-solix-api's name where ported from it
  label: string;
  type: FieldType;
  at?: number; // positional tags: offset after the type byte
  skip?: number; // sequential tags: bytes to skip before this field
  length?: number; // var only
  signed?: boolean;
  factor?: number;
  mask?: number;
  unit?: string;
  role?: FieldRole; // default "info"
  values?: Record<number, string>; // enum labels
  format?: FieldFormat;
  /** Omit the field when it decodes to this value (e.g. empty strings, 0 timestamps). */
  hideWhen?: number | string;
}

export interface TagSpec {
  tag: number;
  group: string;
  sequential?: boolean;
  /** Drop the whole tag unless this field decoded (e.g. no expansion pack fitted). */
  requires?: string;
  fields: FieldSpec[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function readInt(b: Uint8Array, at: number, size: number, signed: boolean): number | undefined {
  if (at + size > b.length) return undefined;
  let v = 0;
  for (let i = size - 1; i >= 0; i--) v = v * 256 + b[at + i]!;
  if (signed && b[at + size - 1]! & 0x80) v -= 2 ** (8 * size);
  return v;
}

/** Size in bytes a field occupies at `at` (str includes its length byte). */
function sizeOf(f: FieldSpec, b: Uint8Array, at: number): number {
  switch (f.type) {
    case "ui": return 1;
    case "sile": return 2;
    case "var": return f.length ?? 4;
    case "version": return 4;
    case "str": return 1 + (b[at] ?? 0);
  }
}

function readRaw(f: FieldSpec, b: Uint8Array, at: number): number | string | undefined {
  switch (f.type) {
    case "ui": {
      const v = readInt(b, at, 1, f.signed === true);
      if (v === undefined || f.mask === undefined) return v;
      let mask = f.mask, value = v;
      while (!(mask & 1)) { mask >>= 1; value >>= 1; }
      return value & mask;
    }
    case "sile": return readInt(b, at, 2, f.signed !== false);
    case "var": return readInt(b, at, f.length ?? 4, f.signed !== false);
    case "version": {
      if (at + 4 > b.length) return undefined;
      return [3, 2, 1, 0].map((i) => b[at + i]).join(".");
    }
    case "str": {
      const len = b[at];
      if (len === undefined || at + 1 + len > b.length) return undefined;
      return new TextDecoder("ascii").decode(b.subarray(at + 1, at + 1 + len)).replace(/[^\x20-\x7e]/g, "").trim();
    }
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

function present(f: FieldSpec, raw: number | string): number | string {
  if (typeof raw === "string") return raw;
  if (f.values) return f.values[raw] !== undefined ? `${f.values[raw]} (${raw})` : `unknown (${raw})`;
  switch (f.format) {
    case "minutes_of_day": return `${pad(Math.floor(raw / 60))}:${pad(raw % 60)}`;
    case "weekdays": {
      const days = WEEKDAYS.filter((_, i) => raw & (1 << i));
      return days.length === 7 ? "every day" : days.join(", ") || "none";
    }
    case "timestamp":
      if (raw === 0) return "none";
      if (raw === 0xffffffff || raw === -1) return "ongoing";
      return new Date(raw * 1000).toLocaleString();
    case "seconds":
      if (raw === 0) return "disabled";
      return raw % 3600 === 0 ? `${raw / 3600} h` : raw % 60 === 0 ? `${raw / 60} min` : `${raw} s`;
  }
  if (f.factor) {
    const digits = Math.max(0, -Math.floor(Math.log10(f.factor)));
    return Number((raw * f.factor).toFixed(digits));
  }
  return raw;
}

/** Decode every mapped field present in `params`. */
export function decodeTags(spec: readonly TagSpec[], params: Params): TelemetryField[] {
  const out: TelemetryField[] = [];
  for (const t of spec) {
    const value = params.get(t.tag);
    if (!value || value.length < 2) continue;
    const b = value.subarray(1); // skip the type byte
    const fields: TelemetryField[] = [];
    let pos = 0;
    for (const f of t.fields) {
      let at: number;
      if (t.sequential) {
        pos += f.skip ?? 0;
        at = pos;
        if (at >= b.length) break;
        pos += sizeOf(f, b, at);
      } else {
        at = f.at ?? 0;
      }
      const raw = readRaw(f, b, at);
      if (raw === undefined || raw === f.hideWhen) continue;
      fields.push({
        key: f.key, label: f.label, role: f.role ?? "info", group: t.group,
        value: present(f, raw), ...(f.unit ? { unit: f.unit } : {}),
      });
    }
    if (!t.requires || fields.some((x) => x.key === t.requires)) out.push(...fields);
  }
  return out;
}
