// Display formatting for raw byte values and decoded telemetry fields.

import type { TelemetryField } from "../ble";

export function toHex(view: DataView | Uint8Array): string {
  const b = view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
}

/** "63.0 h" → "2 d 15 h"; shorter durations as "5 h 30 min". */
export function formatHours(hours: number): string {
  const d = Math.floor(hours / 24);
  const hRem = Math.floor(hours % 24);
  if (d > 0) return `${d} d ${hRem} h`;
  const m = Math.round((hours - Math.floor(hours)) * 60);
  return m ? `${Math.floor(hours)} h ${m} min` : `${Math.floor(hours)} h`;
}

export function formatField(f: TelemetryField): string {
  if (f.role === "time_remaining" && typeof f.value === "number") {
    return `${formatHours(f.value)} (${f.value.toFixed(1)} h)`;
  }
  return `${f.value}${f.unit ? " " + f.unit : ""}`;
}

function toPrintable(view: DataView): string | null {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes.length === 0) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\0+$/, "");
    return /^[\x20-\x7e -￿\t\r\n]*$/.test(s) && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

/** Multi-line description of a buffer: length, hex, text and small-int interpretations. */
export function describeValue(view: DataView): string {
  const lines = [`len=${view.byteLength}  hex: ${toHex(view) || "(empty)"}`];
  const text = toPrintable(view);
  if (text !== null) lines.push(`utf8: ${JSON.stringify(text)}`);
  const n = view.byteLength;
  if (n === 1) lines.push(`u8: ${view.getUint8(0)}  i8: ${view.getInt8(0)}`);
  if (n === 2) lines.push(`u16le: ${view.getUint16(0, true)}  i16le: ${view.getInt16(0, true)}`);
  if (n === 4) lines.push(`u32le: ${view.getUint32(0, true)}  i32le: ${view.getInt32(0, true)}  f32le: ${view.getFloat32(0, true)}`);
  return lines.join("\n");
}
