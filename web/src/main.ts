// Solix BLE Explorer: connect to a BLE device with Web Bluetooth and dump
// everything the API exposes (device, advertisements, GATT tree, values).

import { describeValue, errMsg, propsList, toHex } from "./format";
import {
  DEFAULT_OPTIONAL_SERVICES, characteristicName, descriptorName, parseServiceUuid,
  serviceName, shortUuid,
} from "./uuids";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c);
  return el;
}

function log(msg: string, cls = "") {
  const line = h("span", cls ? { class: cls } : {}, `${new Date().toISOString().slice(11, 23)}  ${msg}\n`);
  const pre = $("log");
  pre.append(line);
  pre.scrollTop = pre.scrollHeight;
  (cls === "err" ? console.error : console.log)(msg);
}

function fillKv(dl: HTMLElement, rows: [string, string][]) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

let device: BluetoothDevice | null = null;
let advAbort: AbortController | null = null;

// ---------------------------------------------------------------- API info

async function renderApiInfo() {
  const bt = navigator.bluetooth;
  const rows: [string, string][] = [
    ["navigator.bluetooth", bt ? "present" : "missing"],
    ["secure context", String(window.isSecureContext)],
    ["user agent", navigator.userAgent],
  ];
  const pill = $("availability");
  if (!bt) {
    pill.textContent = "Web Bluetooth unavailable";
    pill.className = "pill bad";
    $<HTMLButtonElement>("connect").disabled = true;
    fillKv($("api"), rows);
    return;
  }
  try {
    const avail = await bt.getAvailability();
    rows.push(["getAvailability()", String(avail)]);
    pill.textContent = avail ? "Bluetooth available" : "No Bluetooth adapter";
    pill.className = avail ? "pill ok" : "pill bad";
  } catch (e) {
    rows.push(["getAvailability()", errMsg(e)]);
  }
  rows.push(["getDevices()", typeof bt.getDevices === "function" ? "supported" : "unsupported"]);
  if (bt.getDevices) {
    try {
      const devs = await bt.getDevices();
      rows.push(["permitted devices", devs.map((d) => `${d.name ?? "(unnamed)"} [${d.id}]`).join(", ") || "none"]);
      if (devs.length && !device) {
        device = devs[0]!;
        $<HTMLButtonElement>("reconnect").disabled = false;
      }
    } catch (e) {
      rows.push(["permitted devices", errMsg(e)]);
    }
  }
  rows.push(["watchAdvertisements", "watchAdvertisements" in (globalThis.BluetoothDevice?.prototype ?? {}) ? "supported" : "unsupported (enable flag)"]);
  fillKv($("api"), rows);
}

// ---------------------------------------------------------------- device

function renderDevice() {
  if (!device) return fillKv($("device"), [["—", "Not connected"]]);
  fillKv($("device"), [
    ["name", device.name ?? "(none)"],
    ["id", device.id],
    ["gatt.connected", String(device.gatt?.connected ?? false)],
    ["watchingAdvertisements", String(device.watchingAdvertisements ?? "n/a")],
  ]);
  const connected = !!device.gatt?.connected;
  $<HTMLButtonElement>("disconnect").disabled = !connected;
  $<HTMLButtonElement>("rescan").disabled = !connected;
  $<HTMLButtonElement>("reconnect").disabled = connected;
}

function requestOptions(): RequestDeviceOptions {
  const extra = $<HTMLTextAreaElement>("extraServices").value
    .split(/[\n,]/).map(parseServiceUuid).filter((x): x is BluetoothServiceUUID => x !== null);
  const manufacturerIds = $<HTMLInputElement>("manufacturerIds").value
    .split(",").map((s) => s.trim()).filter(Boolean).map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff);
  const opts: RequestDeviceOptions = {
    optionalServices: [...DEFAULT_OPTIONAL_SERVICES, ...extra],
    optionalManufacturerData: manufacturerIds,
  };
  if ($<HTMLInputElement>("acceptAll").checked) opts.acceptAllDevices = true;
  else opts.filters = [{ namePrefix: $<HTMLInputElement>("namePrefix").value || "Anker" }];
  return opts;
}

async function chooseDevice() {
  const opts = requestOptions();
  log(`requestDevice(${JSON.stringify(opts)})`);
  try {
    device = await navigator.bluetooth!.requestDevice(opts);
  } catch (e) {
    log(errMsg(e), "err");
    return;
  }
  device.addEventListener("gattserverdisconnected", () => {
    log("gattserverdisconnected");
    renderDevice();
  });
  log(`selected ${device.name ?? "(unnamed)"} [${device.id}]`);
  await startAdvertisementWatch();
  await connect();
  await renderApiInfo();
}

async function connect() {
  if (!device?.gatt) return;
  renderDevice();
  try {
    log("gatt.connect()…");
    await device.gatt.connect();
    log("connected");
  } catch (e) {
    log(errMsg(e), "err");
  }
  renderDevice();
  if (device.gatt.connected) await renderGatt();
}

// ---------------------------------------------------------------- advertisements

async function startAdvertisementWatch() {
  if (!device?.watchAdvertisements) {
    fillKv($("adv"), [["—", "watchAdvertisements() not supported in this browser"]]);
    return;
  }
  advAbort?.abort();
  advAbort = new AbortController();
  device.addEventListener("advertisementreceived", (ev) => {
    const e = ev as BluetoothAdvertisingEvent;
    const rows: [string, string][] = [
      ["received", new Date().toLocaleTimeString()],
      ["name", e.name ?? "(none)"],
      ["rssi", e.rssi != null ? `${e.rssi} dBm` : "n/a"],
      ["txPower", e.txPower != null ? `${e.txPower} dBm` : "n/a"],
      ["appearance", e.appearance != null ? `0x${e.appearance.toString(16)}` : "n/a"],
      ["uuids", e.uuids.map(shortUuid).join(", ") || "none"],
    ];
    e.manufacturerData.forEach((v, id) => rows.push([`mfr 0x${id.toString(16).padStart(4, "0")}`, toHex(v)]));
    e.serviceData.forEach((v, uuid) => rows.push([`svc ${shortUuid(uuid)}`, toHex(v)]));
    fillKv($("adv"), rows);
  }, { signal: advAbort.signal });
  try {
    await device.watchAdvertisements({ signal: advAbort.signal });
    log("watching advertisements");
  } catch (e) {
    log(`watchAdvertisements: ${errMsg(e)}`, "err");
  }
  renderDevice();
}

// ---------------------------------------------------------------- GATT tree

async function renderGatt() {
  const root = $("gatt");
  root.replaceChildren(h("p", { class: "hint" }, "Enumerating services…"));
  let services: BluetoothRemoteGATTService[];
  try {
    services = await device!.gatt!.getPrimaryServices();
  } catch (e) {
    root.replaceChildren(h("p", { class: "err" }, `getPrimaryServices(): ${errMsg(e)}`),
      h("p", { class: "hint" }, "Only services listed in optionalServices are visible. Add UUIDs under Request options and reconnect."));
    log(`getPrimaryServices: ${errMsg(e)}`, "err");
    return;
  }
  log(`found ${services.length} accessible primary service(s)`);
  root.replaceChildren(...await Promise.all(services.map(renderService)));
}

async function renderService(svc: BluetoothRemoteGATTService): Promise<HTMLElement> {
  const name = serviceName(svc.uuid);
  const el = h("details", { class: "svc", open: "" },
    h("summary", {}, name ? h("span", { class: "name" }, name) : null, shortUuid(svc.uuid),
      svc.isPrimary ? "  (primary)" : ""));
  try {
    const chars = await svc.getCharacteristics();
    for (const c of chars) el.append(await renderCharacteristic(c));
    if (!chars.length) el.append(h("div", { class: "chr hint" }, "no characteristics"));
  } catch (e) {
    el.append(h("div", { class: "chr err" }, `getCharacteristics(): ${errMsg(e)}`));
  }
  return el;
}

async function renderCharacteristic(c: BluetoothRemoteGATTCharacteristic): Promise<HTMLElement> {
  const name = characteristicName(c.uuid);
  const value = h("pre", { class: "value" });
  const actions = h("span", { class: "actions" });
  const el = h("div", { class: "chr" },
    name ? h("span", { class: "name" }, name) : null,
    h("span", { class: "uuid" }, shortUuid(c.uuid)),
    h("span", { class: "props" }, ...propsList(c.properties).map((p) => h("span", {}, p))),
    actions, value);

  const show = (v: DataView, how: string) => { value.textContent = `[${how} ${new Date().toLocaleTimeString()}]\n${describeValue(v)}`; };

  if (c.properties.read) {
    const btn = h("button", { class: "small" }, "read");
    const read = async () => {
      try { show(await c.readValue(), "read"); } catch (e) { value.textContent = errMsg(e); value.classList.add("err"); }
    };
    btn.onclick = read;
    actions.append(btn);
    await read();
  }

  if (c.properties.notify || c.properties.indicate) {
    let on = false;
    const btn = h("button", { class: "small" }, "subscribe");
    c.addEventListener("characteristicvaluechanged", () => {
      if (!c.value) return;
      show(c.value, "notify");
      log(`notify ${shortUuid(c.uuid)}: ${toHex(c.value)}`);
    });
    btn.onclick = async () => {
      try {
        if (on) await c.stopNotifications(); else await c.startNotifications();
        on = !on;
        btn.textContent = on ? "unsubscribe" : "subscribe";
        log(`${on ? "started" : "stopped"} notifications on ${shortUuid(c.uuid)}`);
      } catch (e) {
        log(`notifications ${shortUuid(c.uuid)}: ${errMsg(e)}`, "err");
      }
    };
    actions.append(btn);
  }

  try {
    for (const d of await c.getDescriptors()) {
      const dn = descriptorName(d.uuid);
      let text: string;
      try { text = describeValue(await d.readValue()).replace(/\n/g, "  |  "); } catch (e) { text = errMsg(e); }
      el.append(h("div", { class: "desc" }, `↳ ${dn ? dn + " " : ""}${shortUuid(d.uuid)}: ${text}`));
    }
  } catch (e) {
    // NotFoundError just means "no descriptors".
    if (!(e instanceof DOMException && e.name === "NotFoundError")) {
      el.append(h("div", { class: "desc err" }, `getDescriptors(): ${errMsg(e)}`));
    }
  }
  return el;
}

// ---------------------------------------------------------------- wiring

$("connect").onclick = chooseDevice;
$("reconnect").onclick = async () => { await startAdvertisementWatch(); await connect(); };
$("disconnect").onclick = () => { device?.gatt?.disconnect(); advAbort?.abort(); renderDevice(); };
$("rescan").onclick = renderGatt;
$("clearLog").onclick = () => $("log").replaceChildren();
navigator.bluetooth?.addEventListener("availabilitychanged", () => void renderApiInfo());

void renderApiInfo().then(renderDevice);
