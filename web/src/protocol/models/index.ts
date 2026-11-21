// Model registry. To support a new device: add a DeviceModel file and list it
// here, ahead of `generic`.

import { c2000g2 } from "./c2000g2";
import { gen2 } from "./gen2";
import { generic } from "./generic";
import type { DeviceHints, DeviceModel } from "./types";

export type {
  DeviceHints, DeviceModel, FieldRole, ModelCommand, SettingField, SettingSpec, TelemetryField,
} from "./types";

export const MODELS: readonly DeviceModel[] = [c2000g2, gen2, generic];

export function resolveModel(hints: DeviceHints): DeviceModel {
  return MODELS.find((m) => m.matches(hints)) ?? generic;
}
