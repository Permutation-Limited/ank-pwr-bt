// SOLIX session crypto on WebCrypto, ported from SolixBLE (protocols/outer.py,
// utilities.py).
//
// - P-256 ECDH; public keys travel as raw X||Y (64 bytes, no 0x04 prefix).
// - The 32-byte shared secret is split straight into key (16) and IV (16).
// - "plain" outer: negotiation in the clear, then AES-128-CBC/PKCS7 with key+IV.
// - "encrypted" outer: negotiation under a static AES-GCM key, then AES-GCM
//   with the session key and nonce = IV[0:12]. The nonce never changes.

import { concat, fromHex, own } from "./bytes";

export type OuterName = "plain" | "encrypted";

const STATIC_KEY = fromHex("b8ff7422955d4eb6d554a2c470280559");
const STATIC_NONCE = fromHex("6ba3e3f2f3a60f2971ce5d1f");
const AAD = fromHex("3322110077665544bbaa9988ffeeddcc");

export interface SessionKeys {
  key: Uint8Array; // 16 bytes
  iv: Uint8Array; // 16 bytes (GCM uses the first 12)
}

export const STATIC_KEYS: SessionKeys = { key: STATIC_KEY, iv: STATIC_NONCE };

const subtle = () => globalThis.crypto.subtle;

async function aesKey(raw: Uint8Array, alg: "AES-CBC" | "AES-GCM") {
  return subtle().importKey("raw", own(raw), alg, false, ["encrypt", "decrypt"]);
}

export async function gcmEncrypt(k: SessionKeys, data: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().encrypt(
    { name: "AES-GCM", iv: own(k.iv.subarray(0, 12)), additionalData: own(AAD), tagLength: 128 },
    await aesKey(k.key, "AES-GCM"), own(data));
  return new Uint8Array(out); // ciphertext || 16-byte tag
}

export async function gcmDecrypt(k: SessionKeys, data: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().decrypt(
    { name: "AES-GCM", iv: own(k.iv.subarray(0, 12)), additionalData: own(AAD), tagLength: 128 },
    await aesKey(k.key, "AES-GCM"), own(data));
  return new Uint8Array(out);
}

export async function cbcEncrypt(k: SessionKeys, data: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().encrypt({ name: "AES-CBC", iv: own(k.iv) }, await aesKey(k.key, "AES-CBC"), own(data));
  return new Uint8Array(out); // WebCrypto applies PKCS7 padding
}

export async function cbcDecrypt(k: SessionKeys, data: Uint8Array): Promise<Uint8Array> {
  const out = await subtle().decrypt({ name: "AES-CBC", iv: own(k.iv) }, await aesKey(k.key, "AES-CBC"), own(data));
  return new Uint8Array(out);
}

/** Seal a payload for an outer: clear/CBC on plain, static/session GCM on encrypted. */
export async function sealFor(outer: OuterName, keys: SessionKeys | null, data: Uint8Array) {
  if (outer === "plain") return keys ? cbcEncrypt(keys, data) : data;
  return gcmEncrypt(keys ?? STATIC_KEYS, data);
}

export async function openFor(outer: OuterName, keys: SessionKeys | null, data: Uint8Array) {
  if (outer === "plain") return keys ? cbcDecrypt(keys, data) : data;
  return gcmDecrypt(keys ?? STATIC_KEYS, data);
}

// ------------------------------------------------------------------ ECDH

export async function generateEcdhKey(): Promise<CryptoKeyPair> {
  return subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

/** Raw X||Y of a public key (64 bytes, uncompressed point without 0x04). */
export async function publicXY(pair: CryptoKeyPair): Promise<Uint8Array> {
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return raw.slice(1);
}

/** ECDH with the device's raw X||Y point, split into session key and IV. */
export async function deriveSessionKeys(pair: CryptoKeyPair, deviceXY: Uint8Array): Promise<SessionKeys> {
  const peer = await subtle().importKey(
    "raw", own(concat(Uint8Array.of(0x04), deviceXY)), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: peer }, pair.privateKey, 256));
  return { key: secret.slice(0, 16), iv: secret.slice(16, 32) };
}
