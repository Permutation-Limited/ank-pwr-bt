# ank-pwr-bt

A single-page web app that connects to Anker SOLIX power stations over
**Web Bluetooth** in Chrome, with the goal of showing the same information as
the Anker app.

Click **Connect to SOLIX**. The device picker only lists Anker devices: ones that
advertise the Anker manufacturer record (company `0xffff`) or a SOLIX
service. After you pick one, the page runs the SOLIX handshake (P-256 ECDH, then
AES-CBC or AES-GCM), subscribes to telemetry and shows:

- **Session details:** serial number, MAC, firmware, MTU and the methods the
  device announced.
- **Decoded telemetry:** values decoded with the C1000 Gen 2 field map. These
  are guesses for the C2000.
- **Raw telemetry tags:** every tag the device sends, with changed values
  highlighted, so you can map new fields against the Anker app.

You can also read the generic BLE details: advertisements, plus a GATT tree
(click **Read GATT tree**, or enable it in Options).

The protocol is ported from [SolixBLE](https://github.com/flip-dots/SolixBLE).
`web/src/solix/solix.test.ts` replays SolixBLE's recorded C1000 handshake and
checks that the port matches it byte for byte:

```bash
bazel test //web:solix_test
```

If the handshake stalls on the device's registration step (`x827` status `09`),
the station is waiting for you to approve the browser within 180 s. On the C2000
Gen 2 the only button is the main power button; a short press approves it.

### Tested: SOLIX C2000 Gen 2 (A1783)

- **Discovery:** it advertises as "SOLIX C2000 Gen 2". Chrome only finds it
  while the phone isn't holding the Bluetooth connection, so close the Anker app
  or turn off the phone's Bluetooth first.
- **GATT service:** the command and telemetry characteristics live in
  service `8c850001-0302-41c5-b46e-cf057c562025`, not `0xff09`. SolixBLE never
  needed the service UUID because Bleak looks characteristics up directly.
- **Handshake:** the station drops the plain handshake and accepts the
  encrypted (AES-GCM) one. The firmware reports ESP32 / 0.0.0.3, MTU 253.
- **Telemetry:** after the `4100` subscribe it streams `c900`, then `c421`
  every ~3 s, with the C1000 Gen 2 tag layout.

## Build and run

Bazel (via bazelisk) is the only requirement. Bazel downloads a pinned Bun
binary itself (see `tools/bun/extensions.bzl`).

```bash
bazel run //web:serve
```

Then open http://localhost:8080 in Chrome. `localhost` counts as a secure
context, so you don't need TLS. Pass `-- --port 9000` to change the port.

Only build the static site (output goes to `bazel-bin/web/`):

```bash
bazel build //web:site
```

## Layout

| Path | Purpose |
| --- | --- |
| `MODULE.bazel` | Bzlmod deps: `rules_shell`, plus the Bun download extension |
| `tools/bun/` | Bun repository rule, static file server (`serve.ts`) and its launcher |
| `web/BUILD.bazel` | `app_js` (bun build), `site` filegroup, `serve` runner |
| `web/src/main.ts` | UI, device picker filter, generic GATT explorer |
| `web/src/solix-ui.ts` | Connects a SOLIX session to the GATT characteristics and renders it |
| `web/src/solix/packet.ts` | `ff09` frames, TLV tags, fragment reassembly |
| `web/src/solix/crypto.ts` | ECDH and AES-CBC/GCM on WebCrypto |
| `web/src/solix/session.ts` | Negotiation state machine and session commands |
| `web/src/solix/telemetry.ts` | Telemetry field map (C1000 Gen 2, unverified on C2000) |
| `web/src/solix/advertisement.ts` | Anker manufacturer advertisement record |
| `web/src/uuids.ts` | GATT UUIDs and the `optionalServices` list |
| `web/src/format.ts` | Byte-buffer formatting helpers |

## Web Bluetooth notes

- A page can only enumerate GATT services that were listed in
  `optionalServices` when it called `requestDevice()`. The defaults live in
  `web/src/uuids.ts`. You can add more under **Request options** before you connect.
- Manufacturer data in advertisements only shows up for company IDs listed in
  `optionalManufacturerData`.
- `watchAdvertisements()` needs
  `chrome://flags/#enable-experimental-web-platform-features`.
- `getDevices()` (reconnecting to previously permitted devices) needs
  `chrome://flags/#enable-web-bluetooth-new-permissions-backend`.
- The SOLIX service is `0xff09`. It contains the command characteristic
  `8c850002-…` (write) and the telemetry characteristic `8c850003-…` (notify).
