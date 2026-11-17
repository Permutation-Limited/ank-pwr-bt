// Entry point: wires the SolixClient (ble/) to the panels (ui/).
//
// Layers (enforced by architecture.test.ts):
//   protocol/  SOLIX framing, crypto, session, device models. No DOM, no Web Bluetooth.
//   ble/       Web Bluetooth client built on protocol/. No DOM. ble/index.ts is its API.
//   ui/        DOM rendering. Talks to ble/ only through ble/index.ts.

import { type OuterPreference, SolixClient, bluetoothEnvironment, onAvailabilityChanged, parseServiceUuid } from "./ble";
import { $ } from "./ui/dom";
import { ExplorerPanel } from "./ui/explorer-panel";
import { LogPanel } from "./ui/log-panel";
import { SolixPanel } from "./ui/solix-panel";

const client = new SolixClient();
const log = new LogPanel($("log"));
const explorer = new ExplorerPanel(client, log);
new SolixPanel(client);

client.on("log", ({ message, level }) => log.add(message, level));
client.on("settled", () => {
  if ($<HTMLInputElement>("autoGatt").checked || !client.authorized) void explorer.renderGatt();
});

function readSettings() {
  client.settings = {
    outer: $<HTMLSelectElement>("outer").value as OuterPreference,
    runModelCommands: $<HTMLInputElement>("autoSubscribe").checked,
  };
}

function readFilter() {
  return {
    acceptAll: $<HTMLInputElement>("acceptAll").checked,
    extraServices: $<HTMLTextAreaElement>("extraServices").value
      .split(/[\n,]/).map(parseServiceUuid).filter((x): x is BluetoothServiceUUID => x !== null),
    manufacturerIds: $<HTMLInputElement>("manufacturerIds").value
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff),
  };
}

async function refreshEnvironment() {
  explorer.renderEnvironment(await bluetoothEnvironment());
}

$("connect").onclick = async () => {
  readSettings();
  if (await client.requestDevice(readFilter())) {
    await client.connect();
    await refreshEnvironment();
  }
};
$("reconnect").onclick = () => { readSettings(); void client.connect(); };
$("disconnect").onclick = () => client.disconnect();
$("rescan").onclick = () => void explorer.renderGatt();
$("clearLog").onclick = () => log.clear();
onAvailabilityChanged(() => void refreshEnvironment());

void refreshEnvironment().then(() => client.restorePermittedDevice());
