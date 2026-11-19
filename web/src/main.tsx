// Entry point: one SolixClient (ble/) wrapped in a UI store, rendered by React (ui/).
//
// Layers (enforced by architecture.test.ts):
//   protocol/  SOLIX framing, crypto, session, device models. No DOM, no Web Bluetooth.
//   ble/       Web Bluetooth client built on protocol/. No DOM. ble/index.ts is its API.
//   ui/        React + MUI. Talks to ble/ only through ble/index.ts.
//
// Pages: "#/" status (ui/StatusPage.tsx), "#/debug" diagnostics (ui/DebugPage.tsx).
// One client is shared, so navigating keeps the connection.

import { createRoot } from "react-dom/client";
import { SolixClient } from "./ble";
import { App } from "./ui/App";
import { migrateLegacyPath } from "./ui/route";
import { AppStore } from "./ui/store";

migrateLegacyPath();
const store = new AppStore(new SolixClient());
createRoot(document.getElementById("root")!).render(<App store={store} />);

// Network-first service worker (public/sw.js): lets the installed app open offline.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker:", err));
}
