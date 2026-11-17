// Generic Bluetooth diagnostics: environment, device, advertisements and the
// GATT tree. Renders data from the BLE layer; never calls Web Bluetooth.

import {
  type AdvertisementInfo, type BluetoothEnvironment, type CharacteristicInfo, type ConnectionSnapshot,
  type ServiceInfo, type SolixClient, errMsg, shortUuid,
} from "../ble";
import { $, fillKv, h, setPill } from "./dom";
import { describeValue, toHex } from "./format";
import type { LogPanel } from "./log-panel";

export class ExplorerPanel {
  constructor(private readonly client: SolixClient, private readonly log: LogPanel) {
    client.on("connection", (c) => this.renderConnection(c));
    client.on("advertisement", (a) => this.renderAdvertisement(a));
    client.on("advertisementsUnsupported", ({ reason }) => fillKv($("adv"), [["—", reason]]));
  }

  renderEnvironment(env: BluetoothEnvironment) {
    const rows: [string, string][] = [
      ["navigator.bluetooth", env.present ? "present" : "missing"],
      ["secure context", String(env.secureContext)],
      ["user agent", env.userAgent],
    ];
    if (!env.present) {
      setPill($("availability"), "Web Bluetooth unavailable", "bad");
      $<HTMLButtonElement>("connect").disabled = true;
    } else {
      rows.push(["getAvailability()", env.availabilityError ?? String(env.available)]);
      setPill($("availability"), env.available ? "Bluetooth available" : "No Bluetooth adapter", env.available ? "ok" : "bad");
      rows.push(["getDevices()", env.getDevicesSupported ? "supported" : "unsupported"]);
      if (env.getDevicesSupported) {
        rows.push(["permitted devices", env.permittedDevices.map((d) => `${d.name ?? "(unnamed)"} [${d.id}]`).join(", ") || "none"]);
      }
      rows.push(["watchAdvertisements", env.watchAdvertisementsSupported ? "supported" : "unsupported (enable flag)"]);
    }
    fillKv($("api"), rows);
  }

  renderConnection(c: ConnectionSnapshot) {
    if (!c.device) {
      fillKv($("device"), [["—", "Not connected"]]);
    } else {
      fillKv($("device"), [
        ["name", c.device.name ?? "(none)"],
        ["id", c.device.id],
        ["gatt.connected", String(c.connected)],
        ["watchingAdvertisements", String(c.watchingAdvertisements ?? "n/a")],
      ]);
    }
    $<HTMLButtonElement>("disconnect").disabled = !c.connected;
    $<HTMLButtonElement>("rescan").disabled = !c.connected;
    $<HTMLButtonElement>("reconnect").disabled = c.connected || !c.device;
  }

  private renderAdvertisement(a: AdvertisementInfo) {
    const rows: [string, string][] = [
      ["received", a.at.toLocaleTimeString()],
      ["name", a.name ?? "(none)"],
      ["rssi", a.rssi != null ? `${a.rssi} dBm` : "n/a"],
      ["txPower", a.txPower != null ? `${a.txPower} dBm` : "n/a"],
      ["appearance", a.appearance != null ? `0x${a.appearance.toString(16)}` : "n/a"],
      ["uuids", a.uuids.map(shortUuid).join(", ") || "none"],
      ...a.manufacturerData.map(({ companyId, bytes }): [string, string] =>
        [`mfr 0x${companyId.toString(16).padStart(4, "0")}`, toHex(bytes)]),
      ...a.serviceData.map(({ uuid, bytes }): [string, string] => [`svc ${shortUuid(uuid)}`, toHex(bytes)]),
    ];
    if (a.anker) {
      const r = a.anker;
      rows.push(
        ["anker product", `${r.productType} (${r.productName ?? "unknown to SolixBLE"})`],
        ["anker sku", r.sku],
        ["anker mac", r.mac],
        ["anker capability", r.capability == null ? "absent" : `0x${r.capability.toString(16)}`],
      );
    }
    fillKv($("adv"), rows);
  }

  async renderGatt() {
    const root = $("gatt");
    root.replaceChildren(h("p", { class: "hint" }, "Enumerating services…"));
    let services: ServiceInfo[];
    try {
      services = await this.client.exploreGatt();
    } catch (e) {
      root.replaceChildren(h("p", { class: "err" }, `getPrimaryServices(): ${errMsg(e)}`),
        h("p", { class: "hint" }, "Only services listed in optionalServices are visible. Add UUIDs under Options and reconnect."));
      this.log.add(`getPrimaryServices: ${errMsg(e)}`, "err");
      return;
    }
    root.replaceChildren(...services.map((s) => this.renderService(s)));
  }

  private renderService(s: ServiceInfo): HTMLElement {
    const el = h("details", { class: "svc", open: "" },
      h("summary", {}, s.name ? h("span", { class: "name" }, s.name) : null, shortUuid(s.uuid), s.isPrimary ? "  (primary)" : ""));
    for (const c of s.characteristics) el.append(this.renderCharacteristic(c));
    if (s.error) el.append(h("div", { class: "chr err" }, s.error));
    else if (!s.characteristics.length) el.append(h("div", { class: "chr hint" }, "no characteristics"));
    return el;
  }

  private renderCharacteristic(c: CharacteristicInfo): HTMLElement {
    const value = h("pre", { class: "value" });
    const actions = h("span", { class: "actions" });
    const el = h("div", { class: "chr" },
      c.name ? h("span", { class: "name" }, c.name) : null,
      h("span", { class: "uuid" }, shortUuid(c.uuid)),
      h("span", { class: "props" }, ...c.properties.map((p) => h("span", {}, p))),
      actions, value);
    const show = (v: DataView, how: string) => {
      value.classList.remove("err");
      value.textContent = `[${how} ${new Date().toLocaleTimeString()}]\n${describeValue(v)}`;
    };
    const showErr = (msg: string) => { value.textContent = msg; value.classList.add("err"); };

    if (c.value) show(c.value, "read");
    else if (c.readError) showErr(c.readError);

    if (c.canRead) {
      const btn = h("button", { class: "small" }, "read");
      btn.onclick = async () => { try { show(await c.read(), "read"); } catch (e) { showErr(errMsg(e)); } };
      actions.append(btn);
    }
    if (c.canNotify) {
      let on = false;
      const btn = h("button", { class: "small" }, "subscribe");
      btn.onclick = async () => {
        try {
          await c.setNotifications(!on, (v) => {
            show(v, "notify");
            this.log.add(`notify ${shortUuid(c.uuid)}: ${toHex(v)}`);
          });
          on = !on;
          btn.textContent = on ? "unsubscribe" : "subscribe";
        } catch (e) {
          this.log.add(`notifications ${shortUuid(c.uuid)}: ${errMsg(e)}`, "err");
        }
      };
      actions.append(btn);
    }
    for (const d of c.descriptors) {
      const text = d.value ? describeValue(d.value).replace(/\n/g, "  |  ") : d.error ?? "";
      el.append(h("div", { class: "desc" }, `↳ ${d.name ? d.name + " " : ""}${shortUuid(d.uuid)}: ${text}`));
    }
    if (c.descriptorError) el.append(h("div", { class: "desc err" }, `getDescriptors(): ${c.descriptorError}`));
    return el;
  }
}
