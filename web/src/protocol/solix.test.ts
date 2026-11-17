// Protocol tests against fixtures recorded by SolixBLE (tests/const.py,
// github.com/flip-dots/SolixBLE). Run with `bazel test //web:protocol_test`.

import { createECDH } from "node:crypto";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseAnkerRecord } from "./advertisement";
import { fromHex, hex } from "./bytes";
import { STATIC_KEYS, cbcDecrypt, deriveSessionKeys, gcmDecrypt } from "./crypto";
import { Reassembler, buildPacket, parseCommand, parsePacket, parseParams } from "./packet";
import { CLIENT_ID, SolixSession } from "./session";
import { resolveModel } from "./models";

// --- fixtures (SolixBLE tests/const.py) -----------------------------------

const SOLIX_TEST_PRIVATE_KEY = "7dfbea61cd95cee49c458ad7419e817f1ade9a66136de3c7d5787af1458e39f4";
const TIMESTAMP = 0x698cad42; // the a1 value in the recorded requests

const NEGOTIATION_COMMAND_0 = "ff0936000300010001a10442ad8c69a22462326463306231372d623735642d346162662d626136652d656337633939376332336537b9";
const NEGOTIATION_COMMAND_1 = "ff093d000300010003a10442ad8c69a22462326463306231372d623735642d346162662d626136652d656337633939376332336537a30120a40200f064";
const NEGOTIATION_COMMAND_2 = "ff0936000300010029a10442ad8c69a22462326463306231372d623735642d346162662d626136652d65633763393937633233653791";
const NEGOTIATION_COMMAND_3 = "ff0940000300010005a10442ad8c69a22462326463306231372d623735642d346162662d626136652d656337633939376332336537a30120a40200f0a50140fb";
const NEGOTIATION_COMMAND_4 = "ff094c000300010021a140060ea168f232aedb37fb2d120c49180329ac72ab5ec3eb8fd30a2f252dc5e151dabccd9b1dc1e288704ca760a0d8c918e5c94823a1f609a4bf07fb4c33ee219085";
const SOLIX_NEGOTIATION_4022 = "ff095a00030001402222c97d5c5bf02e0b43c62c864817cd38b9fd152113728513cc88bc4a1b4de3060868d9deacb562ca59a369397627effb179b08be8ba760943b24407712c55e6bb59f3ae7c142a726d0f46a149eeaded44b";

/** What a C1000 answered to each request. */
const C1000_REPLIES: Record<string, string> = {
  [NEGOTIATION_COMMAND_0]: "ff090e00030001080100a1010152",
  [NEGOTIATION_COMMAND_1]: "ff091b00030001080300a10102a202fd00a30144a40101a50102ff",
  [NEGOTIATION_COMMAND_2]: "ff093800030001082900a10103a2054553503332a307302e302e302e33a41041504339464530453237333030323735a506f49d8a104e0c9a",
  [NEGOTIATION_COMMAND_3]: "ff090b00030001080500f2",
  [NEGOTIATION_COMMAND_4]: "ff094d00030001082100a140b2ade5cac4f4a0c1307e44a0e9c5363cb21e4c8485ee324c23be949fa5d5929a75e57da3207c948a0c366ca9ea1ab2cb8e57d2d046a6ebefe5d96adb5d4cb35039",
};

const SOLARBANK2_CLEAR_TELEMETRY = [
  "ff09fd0003010f840513a10131a2110041504347513830463038363030333530a302015ca4020102a503020000a6050301000524a705030000061fa8050300030208a9020100aa02011fab0503f8250000ac050308020000ad02015cae020100af020100b0050360670100b10503b86e0000b205036f830200b3050345670000b402010ab5020105b602010ab7050300000000b8020101b9020100ba050328000000bb020100bc050300000000bd050300000000be050300000000bf050300000000c0110000000000000000000000000000000000c1020100c203022003c4050308020000c5020100c6020101c703023200c8050300000000c9050315",
  "ff09fd0003010f84052300000000ca050300000000cb0503da0c0000cc0503a80c0000cd0503760c0000d2020100d3050308020000d4110000000000000000000000000000000000d503020000d6110000000000000000000000000000000000d703020000d8110000000000000000000000000000000000d903020000da110000000000000000000000000000000000db03020000dc110000000000000000000000000000000000dd03020000de110000000000000000000000000000000000df03020000e0020103e1020100e2020100e3020100e4020100e5020100e6020100e7020100e8020100e9020100ea020101fe0503c6423868fb05030099",
  "ff09260003010f840533000000fc160401010101000101010101000000000000000000000080",
];

// --- helpers ----------------------------------------------------------------

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/** Import the pinned P-256 test key into WebCrypto. */
async function pinnedKeyPair(): Promise<CryptoKeyPair> {
  const d = fromHex(SOLIX_TEST_PRIVATE_KEY);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const pub = new Uint8Array(ecdh.getPublicKey());
  const jwk = { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), ext: true };
  const alg = { name: "ECDH", namedCurve: "P-256" };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, alg, true, ["deriveBits"]);
  const { d: _, ...pubJwk } = jwk;
  const publicKey = await crypto.subtle.importKey("jwk", pubJwk, alg, true, []);
  return { privateKey, publicKey };
}

// --- tests --------------------------------------------------------------------

describe("packet", () => {
  test("parses frames and verifies checksums", () => {
    const p = parsePacket(fromHex(C1000_REPLIES[NEGOTIATION_COMMAND_1]!));
    assert.equal(hex(p.pattern), "030001");
    assert.deepEqual(parseCommand(p.cmd), { fragmented: false, encrypted: false, msgtype: 0x803 });
    const { status, params } = parseParams(p.payload);
    assert.equal(status, 0);
    assert.equal(hex(params.get(0xa2)!), "fd00");
    assert.equal(params.get(0xa3)![0], 0x44);
  });

  test("round-trips a frame", () => {
    const frame = fromHex(NEGOTIATION_COMMAND_0);
    const p = parsePacket(frame);
    assert.equal(hex(buildPacket(p.pattern, p.cmd, p.payload)), NEGOTIATION_COMMAND_0);
  });

  test("rejects a bad checksum", () => {
    const bad = fromHex(NEGOTIATION_COMMAND_0);
    bad[bad.length - 1] ^= 1;
    assert.throws(() => parsePacket(bad));
  });

  test("reassembles fragmented telemetry", () => {
    const r = new Reassembler();
    let payload: Uint8Array | null = null;
    for (const f of SOLARBANK2_CLEAR_TELEMETRY) payload = r.push(parsePacket(fromHex(f)));
    const { params } = parseParams(payload!);
    assert.equal(new TextDecoder().decode(params.get(0xa2)!.subarray(1)), "APCGQ80F08600350");
    assert.equal(params.has(0xfc), true);
  });
});

describe("crypto", () => {
  test("static GCM opens a recorded encrypted-outer request", async () => {
    // Prime charger's encrypted x001 (SolixBLE NEGOTIATION_RESPONSES_PRIME).
    const p = parsePacket(fromHex("ff09200003000140010a82d0ab535303e3aa9f0c2f9c868465bc8476f556fb7d"));
    const plain = await gcmDecrypt(STATIC_KEYS, p.payload);
    assert.equal(hex(plain).startsWith("a104"), true);
    // ...and the device's reply to it.
    const r = parsePacket(fromHex("ff091e000300014801ab273ed3e27270c3f4d676ac7d69a00572793732a6"));
    const reply = parseParams(await gcmDecrypt(STATIC_KEYS, r.payload));
    assert.equal(reply.status, 0);
  });

  test("ECDH + CBC open the recorded C1000 x022", async () => {
    const pair = await pinnedKeyPair();
    const deviceXY = parseParams(parsePacket(fromHex(C1000_REPLIES[NEGOTIATION_COMMAND_4]!)).payload).params.get(0xa1)!;
    const keys = await deriveSessionKeys(pair, deviceXY);
    const plain = await cbcDecrypt(keys, parsePacket(fromHex(SOLIX_NEGOTIATION_4022)).payload);
    const { params } = parseParams(plain);
    assert.equal(new TextDecoder().decode(params.get(0xa2)!), CLIENT_ID);
  });

  test("advertisement record", () => {
    const rec = parseAnkerRecord(new DataView(fromHex("01aa12deadb34500b402514a4204").buffer))!;
    assert.equal(rec.productType, "b402");
    assert.equal(rec.sku, "QJB");
    assert.equal(rec.capability, 0x04);
    assert.equal(rec.mac, "AA:12:DE:AD:B3:45");
  });
});

describe("session", () => {
  test("negotiates the plain outer byte-for-byte with a recorded C1000", async () => {
    const sent: string[] = [];
    const pair = await pinnedKeyPair();
    let session!: SolixSession;
    session = new SolixSession({
      outer: "plain",
      now: () => TIMESTAMP,
      generateKey: async () => pair,
      timezone: () => ({ offsetWest: 0, posix: "GMT0BST,M3.5.0/1,M10.5.0" }),
      write: async (frame) => {
        const h = hex(frame);
        sent.push(h);
        const reply = C1000_REPLIES[h];
        if (reply) queueMicrotask(() => void session.handleNotification(fromHex(reply)));
      },
    });
    await session.open();
    // Let the reply chain run to completion.
    for (let i = 0; i < 50 && sent.length < 6; i++) await new Promise((r) => setTimeout(r, 5));

    assert.deepEqual(sent.slice(0, 5), [
      NEGOTIATION_COMMAND_0, NEGOTIATION_COMMAND_1, NEGOTIATION_COMMAND_2,
      NEGOTIATION_COMMAND_3, NEGOTIATION_COMMAND_4,
    ]);
    assert.equal(session.announcement.serial, "APC9FE0E27300275");
    assert.equal(session.announcement.mac, "F4:9D:8A:10:4E:0C");

    // 6th frame: x022 under the session keys (CBC), cmd 4022.
    const x022 = parsePacket(fromHex(sent[5]!));
    assert.equal(hex(x022.cmd), "4022");
    const deviceXY = parseParams(parsePacket(fromHex(C1000_REPLIES[NEGOTIATION_COMMAND_4]!)).payload).params.get(0xa1)!;
    const keys = await deriveSessionKeys(pair, deviceXY);
    const { params } = parseParams(await cbcDecrypt(keys, x022.payload));
    assert.equal(new TextDecoder().decode(params.get(0xa2)!), CLIENT_ID);
    assert.equal(new TextDecoder().decode(params.get(0xa5)!), "GMT0BST,M3.5.0/1,M10.5.0");
    assert.equal(session.state, "negotiating");
  });
});

describe("device models", () => {
  test("resolves models from name, product type and part number", () => {
    assert.equal(resolveModel({ name: "SOLIX C2000 Gen 2" }).id, "solix-gen2");
    assert.equal(resolveModel({ name: "SOLIX C1000 Gen 2" }).id, "solix-gen2");
    assert.equal(resolveModel({ productType: "b118" }).id, "solix-gen2");
    assert.equal(resolveModel({ partNumber: "A1783" }).id, "solix-gen2");
    assert.equal(resolveModel({ name: "Anker SOLIX F3800" }).id, "solix-generic");
    assert.equal(resolveModel({}).id, "solix-generic");
  });

  test("gen2 decodes telemetry captured live from a C2000 Gen 2 (c421)", () => {
    const params = new Map<number, Uint8Array>([
      [0xa2, fromHex("062011415858585858585858303030303030303100054131373833060102010001")],
      [0xa5, fromHex("041c0064e800")],
      [0xa6, fromHex("042600000000007a0264")],
      [0xa7, fromHex("04011f00000000")],
      [0xa8, fromHex("04010000")],
      [0xaa, fromHex("04010100")],
      [0xab, fromHex("04010600")],
      [0xb2, fromHex("04000000")],
      [0xd9, fromHex("040000066401000000003eeadc694ef8dc690000000000000000")],
      [0xc0, fromHex("04114150435858585858583030303030303032010303090114015ce801010001000a41313738335f326b5768")],
    ]);
    const model = resolveModel({ name: "SOLIX C2000 Gen 2" });
    const f = Object.fromEntries(model.decodeTelemetry("c421", params).map((x) => [x.key, x.value]));
    const expected = {
      serial: "AXXXXXXXX00000001", part_number: "A1783", battery_percent: 100, temperature: 28,
      power_out: 38, ac_out: 31, ac_port: "output", solar_port: "input", usb_c1: 1, usb_c2: 6,
      dc_port: "not connected", max_charge: 100,
      // a6[7:9] = 0x027a = 634 -> 63.4 h; the station's screen showed 2 d 15 h.
      time_remaining: 63.4,
      expansion_battery_percent: 92, expansion_temperature: 20,
      expansion_serial: "APCXXXXXX00000002", expansion_model: "A1783_2kWh",
    };
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map((k) => [k, f[k]])), expected);
    assert.equal(model.partNumber!(params), "A1783");
    // Without an expansion pack in c0, no expansion fields appear.
    const noExpansion = new Map([...params].filter(([k]) => k !== 0xc0));
    assert.equal(model.decodeTelemetry("c421", noExpansion).some((x) => x.key.startsWith("expansion")), false);
    assert.deepEqual(model.decodeTelemetry("0300", params), []);
  });
});
