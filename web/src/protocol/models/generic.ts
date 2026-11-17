// Fallback for SOLIX devices no model claims: negotiate, show raw tags, send
// nothing model-specific. Users can still send commands by hand.

import type { DeviceModel } from "./types";

export const generic: DeviceModel = {
  id: "solix-generic",
  name: "SOLIX device (unknown model)",
  matches: () => true,
  onAuthorized: [],
  decodeTelemetry: () => [],
};
