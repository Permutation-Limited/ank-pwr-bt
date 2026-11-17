// Small byte helpers shared by the SOLIX protocol modules.

export const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/\s+/g, "");
  if (clean.length % 2) throw new Error(`odd-length hex: ${s}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const u8 = (n: number) => Uint8Array.of(n & 0xff);
export const u16le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
export const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
};
export const i32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
};
export const utf8 = (s: string) => new TextEncoder().encode(s);

/** Little-endian unsigned/signed integer from up to 6 bytes. */
export function readUintLE(b: Uint8Array, signed = false): number {
  let v = 0;
  for (let i = b.length - 1; i >= 0; i--) v = v * 256 + b[i]!;
  if (signed && b.length && b[b.length - 1]! & 0x80) v -= 2 ** (8 * b.length);
  return v;
}

/** Copy into a fresh ArrayBuffer-backed array (WebCrypto and BLE want plain buffers). */
export const own = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
