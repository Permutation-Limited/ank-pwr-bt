# ank-pwr-bt

See and monitor Anker SOLIX power stations straight from Chrome over Web
Bluetooth. No app or cloud account needed.

![Status page showing a SOLIX C2000 Gen 2 at 100% battery with 38 W output](docs/status.png)

## Run it

You only need Bazel (via bazelisk). Bazel downloads Bun itself.

```bash
bazel run //web:serve
```

Open http://localhost:8080 in Chrome and click **Connect**. The power station
accepts one Bluetooth connection at a time, so close the Anker app on your phone
(or turn off its Bluetooth) first. If the station asks you to approve the browser,
short-press its power or IoT button.

- **`/`**: battery level and power in and out, live.
- **`/debug`**: session details, raw telemetry tags, advertisements, the GATT tree and a protocol log.

```bash
bazel test //web:solix_test   # protocol, device model and layering tests
```

## How it works

The SOLIX Bluetooth protocol (framing, P-256 ECDH, AES-CBC/GCM) is ported from
[SolixBLE](https://github.com/flip-dots/SolixBLE). The code is in three layers,
each depending only on the one below. `web/src/architecture.test.ts` enforces this:

| Layer | Path | Role |
| --- | --- | --- |
| Protocol | `web/src/protocol/` | Framing, crypto, handshake, device models. No DOM or Web Bluetooth. |
| BLE client | `web/src/ble/` | `SolixClient`: connection, handshake retries, typed events. No DOM. |
| UI | `web/src/ui/` | Status and debug pages, rendered from client events. |

**Device models** (`web/src/protocol/models/`) hold everything model-specific:
how to recognize the device, its handshake, its start-up commands and its
telemetry decoder. Each decoded field has a role (battery, input, output and so
on), so the status page works for any model. Unrecognized SOLIX devices still
connect and show raw data on `/debug`.

| Model | Devices |
| --- | --- |
| `solix-gen2` | C1000 / C1000X Gen 2, C1000 Plus, C2000 Gen 2 (tested) |
| `solix-generic` | Any other SOLIX device (raw data only) |

To add a device, write a `DeviceModel` and register it in
`protocol/models/index.ts`. SolixBLE's `devices/*.py` field maps port over
directly.
