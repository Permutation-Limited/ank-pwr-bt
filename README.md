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
- **Decoded telemetry:** values decoded by the matching device model (see
  *Device models* below). Unknown SOLIX devices still negotiate and show raw tags.
- **Raw telemetry tags:** every tag the device sends, with changed values
  highlighted, so you can map new fields against the Anker app.

You can also read the generic BLE details: advertisements, plus a GATT tree
(click **Read GATT tree**, or enable it in Options).

The protocol is ported from [SolixBLE](https://github.com/flip-dots/SolixBLE).
`web/src/protocol/solix.test.ts` replays SolixBLE's recorded C1000 handshake
byte for byte and decodes telemetry captured from a C2000 Gen 2;
`web/src/architecture.test.ts` enforces the layering below:

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

## Architecture

Three layers, each depending only on the one below. `web/src/architecture.test.ts` enforces this:

| Layer | Path | Rules |
| --- | --- | --- |
| Protocol | `web/src/protocol/` | SOLIX framing, crypto, negotiation, device models. Pure TS + WebCrypto: no DOM, no Web Bluetooth. Public API: `protocol/index.ts`. |
| BLE client | `web/src/ble/` | `SolixClient`: device picker, GATT connection, handshake retries and fallback, model resolution. Emits typed events (`log`, `connection`, `session`, `telemetry`, `advertisement`, `settled`). No DOM. Public API: `ble/index.ts`. |
| UI | `web/src/ui/`, `web/src/main.ts` | Panels render client events and call client methods. They import only `ble/index.ts`. |

### Device models

Everything model-specific sits behind `DeviceModel` (`protocol/models/types.ts`):
how to recognize the device (advertised name, Anker product type, part number
from telemetry), its preferred handshake, the commands to send once
authorized, and its telemetry decoder. `resolveModel()` picks the first model
that matches. `generic` matches everything else and shows raw tags only.

| Model | File | Covers |
| --- | --- | --- |
| `solix-gen2` | `protocol/models/gen2.ts` | C1000 / C1000X Gen 2, C1000 Plus, C2000 Gen 2 |
| `solix-generic` | `protocol/models/generic.ts` | Any other SOLIX device (raw tags only) |

To add a device, write a `DeviceModel` and list it in `protocol/models/index.ts`
ahead of `generic`. SolixBLE's `devices/*.py` field maps port over directly.

### Other paths

| Path | Purpose |
| --- | --- |
| `MODULE.bazel` | Bzlmod deps: `rules_shell`, plus the Bun download extension |
| `tools/bun/` | Bun repository rule, static file server, and the serve and test launchers |
| `web/BUILD.bazel` | `app_js` (bun build), `site`, `serve`, `solix_test` |
| `web/src/ble/uuids.ts` | GATT UUIDs and the `optionalServices` list |

## Web Bluetooth notes

- A page can only enumerate GATT services that were listed in
  `optionalServices` when it called `requestDevice()`. The defaults live in
  `web/src/ble/uuids.ts`. You can add more under **Options** before you connect.
- Manufacturer data in advertisements only shows up for company IDs listed in
  `optionalManufacturerData`.
- `watchAdvertisements()` needs
  `chrome://flags/#enable-experimental-web-platform-features`.
- `getDevices()` (reconnecting to previously permitted devices) needs
  `chrome://flags/#enable-web-bluetooth-new-permissions-backend`.
- The command characteristic `8c850002-…` (write) and the telemetry
  characteristic `8c850003-…` (notify) live in service `8c850001-…`. `0xff09`
  is only an identifying UUID.
