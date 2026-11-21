// Public surface of the SOLIX protocol layer. Pure TypeScript + WebCrypto:
// no DOM and no Web Bluetooth, so it runs anywhere (browser, Bun tests, a
// future Node/BLE bridge).

export { type AnkerRecord, CAPABILITY_ENCRYPTED_ECDH, KNOWN_PRODUCT_TYPES, parseAnkerRecord } from "./advertisement";
export { fromHex, hex } from "./bytes";
export type { OuterName } from "./crypto";
export {
  type Announcement, CLIENT_ID, type SessionMessage, type SessionState, SolixSession,
} from "./session";
export {
  type DeviceHints, type DeviceModel, type FieldRole, MODELS, type ModelCommand, type SettingField, type SettingSpec,
  type TelemetryField, resolveModel,
} from "./models";
export { type CommandOptions, type TimestampStyle, buildSettingCommand, settingCmd } from "./settings";
export { type Params, buildParams, parseParams } from "./packet";
