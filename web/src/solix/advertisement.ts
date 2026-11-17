// Anker manufacturer advertisement record (company 0xffff), from SolixBLE's
// advertisement.py:
//   version_code | mac(6) | bind_type | product_type(2) | sku(3 or 4) | capability?
// capability bit 0x04 means the device accepts the encrypted negotiation.

import { hex } from "./bytes";

export const CAPABILITY_ENCRYPTED_ECDH = 0x04;

export interface AnkerRecord {
  versionCode: number;
  mac: string;
  bindType: number;
  productType: string; // hex, e.g. "b118" (C1000 Gen 2 / A1763)
  sku: string;
  capability: number | null;
}

export function parseAnkerRecord(view: DataView): AnkerRecord | null {
  const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const version = b[0];
  const skuLen = version === 1 ? 3 : version === 2 ? 4 : 0;
  if (!skuLen || b.length < 10 + skuLen) return null;
  const mac = Array.from(b.subarray(1, 7), (x) => x.toString(16).padStart(2, "0")).join(":").toUpperCase();
  return {
    versionCode: version!,
    mac,
    bindType: b[7]!,
    productType: hex(b.subarray(8, 10)),
    sku: new TextDecoder("ascii").decode(b.subarray(10, 10 + skuLen)).replace(/\0+$/, ""),
    capability: b.length > 10 + skuLen ? b[10 + skuLen]! : null,
  };
}

/** Product types SolixBLE knows (hex -> model). */
export const KNOWN_PRODUCT_TYPES: Record<string, string> = {
  b402: "Prime Charger 250W",
  b118: "C1000 Gen 2 (A1763)",
  b119: "C1000 Gen 2 (A1765)",
  b106: "F3800 (A1790)",
  b112: "F3800 Plus (A1790P)",
  b103: "C800 (A1753/4/5)",
  b006: "Solarbank 2 (A17C1)",
};
