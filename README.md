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
press the power station's IoT/Bluetooth button to approve the browser.

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
