// GATT UUIDs for Anker SOLIX devices and friendly names for well-known ones.
// Web Bluetooth only lets a page enumerate services that were listed in
// `optionalServices` (or a filter) at requestDevice() time.
//
// Anker values come from the SolixBLE project (github.com/flip-dots/SolixBLE).

const BASE = "-0000-1000-8000-00805f9b34fb";
const short = (n: number) => n.toString(16).padStart(8, "0") + BASE;

/** Primary SOLIX service: carries ``ff09`` frames and a negotiated session. */
export const SOLIX_SERVICE = short(0xff09);
/** Write characteristic for commands and negotiation requests. */
export const SOLIX_COMMAND = "8c850002-0302-41c5-b46e-cf057c562025";
/** Notify characteristic for telemetry and negotiation replies. */
export const SOLIX_TELEMETRY = "8c850003-0302-41c5-b46e-cf057c562025";

/** Legacy transport (767 / F2000 on older firmware). Not spoken yet. */
export const SOLIX_LEGACY_SERVICE = short(0x1780);
/** Transport used by Prime power banks. Not spoken yet. */
export const SOLIX_2215_SERVICE = short(0x2215);

/** BLE company identifier Anker publishes its advertisement record under. */
export const ANKER_COMPANY_ID = 0xffff;

export const SOLIX_SERVICES = [SOLIX_SERVICE, SOLIX_LEGACY_SERVICE, SOLIX_2215_SERVICE];

const SERVICES: Record<string, string> = {
  [short(0x1800)]: "Generic Access",
  [short(0x1801)]: "Generic Attribute",
  [short(0x180a)]: "Device Information",
  [short(0x180f)]: "Battery Service",
  [SOLIX_SERVICE]: "Anker SOLIX",
  [SOLIX_LEGACY_SERVICE]: "Anker SOLIX (legacy transport)",
  [SOLIX_2215_SERVICE]: "Anker (2215 transport)",
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
  [SOLIX_COMMAND]: "SOLIX command (write)",
  [SOLIX_TELEMETRY]: "SOLIX telemetry (notify)",
  [short(0x7777)]: "SOLIX legacy command",
  [short(0x8888)]: "SOLIX legacy telemetry",
  "22150002-4002-81c5-b46e-cf057c562025": "2215 command",
  "22150003-4002-81c5-b46e-cf057c562025": "2215 telemetry",
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
