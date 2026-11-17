// Site header: connection indicator and Disconnect state, on every page.

import type { ConnectionSnapshot, SessionSnapshot, SolixClient } from "../ble";
import { $, setPill } from "./dom";

export class Header {
  private conn: ConnectionSnapshot = { device: null, connected: false };
  private session: SessionSnapshot | null = null;

  constructor(client: SolixClient) {
    client.on("connection", (c) => { this.conn = c; this.render(); });
    client.on("session", (s) => { this.session = s; this.render(); });
    this.render();
  }

  private render() {
    const pill = $("connPill");
    const name = this.conn.device?.name ?? "device";
    const state = this.session?.state;
    if (!this.conn.device) setPill(pill, "Not connected", "");
    else if (!this.conn.connected) setPill(pill, "Disconnected", "");
    else if (state === "authorized") setPill(pill, `Connected · ${name}`, "ok");
    else if (state === "awaiting-confirmation") setPill(pill, "Approve on device", "warn");
    else if (state === "failed" || state === "unsupported") setPill(pill, `Connected · ${name} (no SOLIX session)`, "bad");
    else setPill(pill, "Connecting…", "");
    $<HTMLButtonElement>("disconnect").hidden = !this.conn.connected;
    $<HTMLButtonElement>("connect").hidden = this.conn.connected;
  }
}
