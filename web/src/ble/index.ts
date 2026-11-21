// Public surface of the BLE layer: the only module the UI imports.

export {
  type AdvertisementInfo, type ClientEvents, type ClientSettings, type ConnectionSnapshot, type DeviceFilter,
  type LogLevel, type OuterPreference, type SessionSnapshot, SolixClient, type TelemetryEvent,
} from "./solix-client";
export { type BluetoothEnvironment, bluetoothEnvironment, onAvailabilityChanged } from "./environment";
export type { CharacteristicInfo, DescriptorInfo, ServiceInfo } from "./gatt-explorer";
export { errMsg } from "./emitter";
export { parseServiceUuid, shortUuid } from "./uuids";
export {
  type FieldRole, type SettingField, type SettingSpec, type TelemetryField, type TimestampStyle, buildParams, fromHex,
  hex, parseParams, settingCmd,
} from "../protocol";
