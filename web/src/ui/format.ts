// Display formatting for raw byte values.

export function toHex(view: DataView | Uint8Array): string {
  const b = view instanceof Uint8Array ? view : new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
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
