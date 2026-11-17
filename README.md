# ank-pwr-bt

A single-page web app that connects to Anker SOLIX power stations over
**Web Bluetooth** in Chrome, with the goal of showing the same information as
the Anker app.

Current stage: a generic BLE explorer. Click **Connect via Bluetooth**, pick a
device, and the page shows everything the Web Bluetooth API exposes: device
id and name, advertisements (RSSI, TX power, manufacturer and service data),
and the full GATT tree with characteristic properties, read values, descriptors,
and live notifications.

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
| `web/src/main.ts` | UI and Web Bluetooth logic |
| `web/src/uuids.ts` | Known GATT UUIDs and the `optionalServices` list |
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
- The SOLIX service UUID `8c850001-0302-41c5-b46e-cf057c562025` comes from
  community reverse engineering. It hasn't been checked against a real device yet.
