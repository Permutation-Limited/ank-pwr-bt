// What the browser's Web Bluetooth implementation supports.

import { errMsg } from "./emitter";

export interface BluetoothEnvironment {
  present: boolean;
  secureContext: boolean;
  userAgent: string;
  /** navigator.bluetooth.getAvailability(); undefined if it threw. */
  available?: boolean;
  availabilityError?: string;
  getDevicesSupported: boolean;
  /** Devices this origin already has permission for (getDevices()). */
  permittedDevices: { id: string; name?: string }[];
  watchAdvertisementsSupported: boolean;
}

export async function bluetoothEnvironment(): Promise<BluetoothEnvironment> {
  const bt = navigator.bluetooth;
  const env: BluetoothEnvironment = {
    present: !!bt,
    secureContext: globalThis.isSecureContext ?? false,
    userAgent: navigator.userAgent,
    getDevicesSupported: typeof bt?.getDevices === "function",
    permittedDevices: [],
    watchAdvertisementsSupported:
      "watchAdvertisements" in ((globalThis as { BluetoothDevice?: { prototype: object } }).BluetoothDevice?.prototype ?? {}),
  };
  if (!bt) return env;
  try { env.available = await bt.getAvailability(); } catch (e) { env.availabilityError = errMsg(e); }
  if (bt.getDevices) {
    try {
      env.permittedDevices = (await bt.getDevices()).map((d) => ({ id: d.id, name: d.name }));
    } catch { /* leave empty */ }
  }
  return env;
}

export function onAvailabilityChanged(fn: () => void): () => void {
  navigator.bluetooth?.addEventListener("availabilitychanged", fn);
  return () => navigator.bluetooth?.removeEventListener("availabilitychanged", fn);
}
