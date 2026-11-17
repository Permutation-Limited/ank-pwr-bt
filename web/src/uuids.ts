// Human-readable names for well-known GATT UUIDs, plus the services we ask
// Chrome for access to. Web Bluetooth only lets a page enumerate services that
// were listed in `optionalServices` (or a filter) at requestDevice() time.

/**
 * Anker SOLIX power stations expose a vendor service with a write
 * characteristic (commands) and a notify characteristic (telemetry).
 * UUIDs as reported by community reverse-engineering (e.g. SolixBLE); verify
 * against a real device.
 */
export const ANKER_SOLIX_SERVICE = "8c850001-0302-41c5-b46e-cf057c562025";
export const ANKER_SOLIX_WRITE = "8c850002-0302-41c5-b46e-cf057c562025";
export const ANKER_SOLIX_NOTIFY = "8c850003-0302-41c5-b46e-cf057c562025";

const BASE = "-0000-1000-8000-00805f9b34fb";
const short = (n: number) => n.toString(16).padStart(8, "0") + BASE;

const SERVICES: Record<string, string> = {
  [short(0x1800)]: "Generic Access",
  [short(0x1801)]: "Generic Attribute",
  [short(0x180a)]: "Device Information",
  [short(0x180f)]: "Battery Service",
  [short(0x1805)]: "Current Time",
  [short(0x181c)]: "User Data",
  [short(0xfe59)]: "Nordic DFU",
  [short(0xfff0)]: "Vendor (0xFFF0)",
  [short(0xffe0)]: "Vendor (0xFFE0)",
  [short(0xff00)]: "Vendor (0xFF00)",
  [short(0xae00)]: "Vendor (0xAE00)",
  [ANKER_SOLIX_SERVICE]: "Anker SOLIX",
};

const CHARACTERISTICS: Record<string, string> = {
  [short(0x2a00)]: "Device Name",
  [short(0x2a01)]: "Appearance",
  [short(0x2a04)]: "Peripheral Preferred Connection Parameters",
  [short(0x2a05)]: "Service Changed",
  [short(0x2a19)]: "Battery Level",
  [short(0x2a23)]: "System ID",
  [short(0x2a24)]: "Model Number",
  [short(0x2a25)]: "Serial Number",
  [short(0x2a26)]: "Firmware Revision",
  [short(0x2a27)]: "Hardware Revision",
  [short(0x2a28)]: "Software Revision",
  [short(0x2a29)]: "Manufacturer Name",
  [short(0x2a50)]: "PnP ID",
  [ANKER_SOLIX_WRITE]: "Anker SOLIX command (write)",
  [ANKER_SOLIX_NOTIFY]: "Anker SOLIX telemetry (notify)",
};

const DESCRIPTORS: Record<string, string> = {
  [short(0x2900)]: "Characteristic Extended Properties",
  [short(0x2901)]: "Characteristic User Description",
  [short(0x2902)]: "Client Characteristic Configuration",
  [short(0x2904)]: "Characteristic Presentation Format",
};

export const DEFAULT_OPTIONAL_SERVICES: string[] = Object.keys(SERVICES);

export const serviceName = (uuid: string) => SERVICES[uuid.toLowerCase()];
export const characteristicName = (uuid: string) => CHARACTERISTICS[uuid.toLowerCase()];
export const descriptorName = (uuid: string) => DESCRIPTORS[uuid.toLowerCase()];

/** Display 16-bit SIG UUIDs compactly, e.g. "0x180a". */
export function shortUuid(uuid: string): string {
  const u = uuid.toLowerCase();
  if (u.endsWith(BASE) && u.startsWith("0000")) return "0x" + u.slice(4, 8);
  return u;
}

/** Accept "0x180a", "180a", "battery_service" or a full 128-bit UUID. */
export function parseServiceUuid(s: string): BluetoothServiceUUID | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/^(0x)?[0-9a-f]{4}$/.test(t)) return parseInt(t.replace(/^0x/, ""), 16);
  if (/^(0x)?[0-9a-f]{8}$/.test(t)) return parseInt(t.replace(/^0x/, ""), 16);
  return t;
}
