// Generic GATT inspection as plain data: enumerate services, characteristics,
// values and descriptors. Characteristic handles expose read/notify as
// methods so callers never touch Web Bluetooth directly.

import { errMsg } from "./emitter";
import { characteristicName, descriptorName, serviceName } from "./uuids";

export interface DescriptorInfo {
  uuid: string;
  name?: string;
  value?: DataView;
  error?: string;
}

export interface CharacteristicInfo {
  uuid: string;
  name?: string;
  properties: string[];
  value?: DataView;
  readError?: string;
  descriptors: DescriptorInfo[];
  descriptorError?: string;
  canRead: boolean;
  canNotify: boolean;
  read(): Promise<DataView>;
  /** Start/stop notifications; ``onValue`` gets each new value while on. */
  setNotifications(on: boolean, onValue: (v: DataView) => void): Promise<void>;
}

export interface ServiceInfo {
  uuid: string;
  name?: string;
  isPrimary: boolean;
  characteristics: CharacteristicInfo[];
  error?: string;
}

const PROPERTY_KEYS: (keyof BluetoothCharacteristicProperties)[] = [
  "broadcast", "read", "writeWithoutResponse", "write", "notify", "indicate",
  "authenticatedSignedWrites", "reliableWrite", "writableAuxiliaries",
];

/** Throws if no services are accessible (only optionalServices are visible). */
export async function exploreGatt(server: BluetoothRemoteGATTServer): Promise<ServiceInfo[]> {
  const services = await server.getPrimaryServices();
  const out: ServiceInfo[] = [];
  for (const s of services) out.push(await describeService(s)); // sequential: GATT ops don't overlap
  return out;
}

async function describeService(svc: BluetoothRemoteGATTService): Promise<ServiceInfo> {
  const info: ServiceInfo = { uuid: svc.uuid, name: serviceName(svc.uuid), isPrimary: svc.isPrimary, characteristics: [] };
  try {
    for (const c of await svc.getCharacteristics()) info.characteristics.push(await describeCharacteristic(c));
  } catch (e) {
    info.error = `getCharacteristics(): ${errMsg(e)}`;
  }
  return info;
}

async function describeCharacteristic(c: BluetoothRemoteGATTCharacteristic): Promise<CharacteristicInfo> {
  let listener: ((ev: Event) => void) | null = null;
  const info: CharacteristicInfo = {
    uuid: c.uuid,
    name: characteristicName(c.uuid),
    properties: PROPERTY_KEYS.filter((k) => c.properties[k]),
    descriptors: [],
    canRead: c.properties.read,
    canNotify: c.properties.notify || c.properties.indicate,
    read: () => c.readValue(),
    async setNotifications(on, onValue) {
      if (listener) c.removeEventListener("characteristicvaluechanged", listener);
      listener = null;
      if (on) {
        listener = () => { if (c.value) onValue(c.value); };
        c.addEventListener("characteristicvaluechanged", listener);
        await c.startNotifications();
      } else {
        await c.stopNotifications();
      }
    },
  };
  if (info.canRead) {
    try { info.value = await c.readValue(); } catch (e) { info.readError = errMsg(e); }
  }
  try {
    for (const d of await c.getDescriptors()) {
      const di: DescriptorInfo = { uuid: d.uuid, name: descriptorName(d.uuid) };
      try { di.value = await d.readValue(); } catch (e) { di.error = errMsg(e); }
      info.descriptors.push(di);
    }
  } catch (e) {
    // NotFoundError just means "no descriptors".
    if (!(e instanceof DOMException && e.name === "NotFoundError")) info.descriptorError = errMsg(e);
  }
  return info;
}
