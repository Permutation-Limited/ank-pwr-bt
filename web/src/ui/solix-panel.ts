// Renders a SolixClient's session and telemetry. Reads only client events.

import { type SessionSnapshot, type SolixClient, type TelemetryEvent, hex } from "../ble";
import { $, fillKv, h, setPill } from "./dom";

export class SolixPanel {
  private lastParams = new Map<string, Map<number, string>>();

  constructor(private readonly client: SolixClient) {
    client.on("session", (s) => this.renderSession(s));
    client.on("telemetry", (t) => this.renderTelemetry(t));
    $("solixSubscribe").onclick = () => void client.runModelCommands();
  }

  private renderSession(s: SessionSnapshot) {
    const tone = s.state === "authorized" ? "ok" : s.state === "failed" || s.state === "unsupported" ? "bad"
      : s.state === "awaiting-confirmation" ? "warn" : "";
    setPill($("solixState"), s.state.replace(/-/g, " "), tone);
    const a = s.announcement;
    const rows: [string, string][] = [
      ["model", s.model.name],
      ["handshake", s.outer ?? "—"],
      ["serial", a.serial ?? "—"],
      ["MAC", a.mac ?? "—"],
      ["chip / firmware", [a.chip, a.firmware].filter(Boolean).join(" / ") || "—"],
      ["MTU", a.mtu?.toString() ?? "—"],
      ["methods", a.encryptMethod != null
        ? `base 0x${(a.baseMethod ?? 0).toString(16)} · encrypt 0x${a.encryptMethod.toString(16)} · auth ${a.authMethod ?? "—"}`
        : "—"],
    ];
    if (s.error) rows.push(["error", s.error]);
    fillKv($("solixInfo"), rows);

    const btn = $<HTMLButtonElement>("solixSubscribe");
    const cmds = this.client.modelCommands;
    btn.hidden = cmds.length === 0;
    btn.textContent = cmds.map((c) => c.description).join(", ") || "model commands";
    btn.disabled = s.state !== "authorized";
  }

  private renderTelemetry(t: TelemetryEvent) {
    const prev = this.lastParams.get(t.cmd) ?? new Map<number, string>();
    const rows = [...t.params].map(([k, v]) => ({ k, hex: hex(v) }));
    this.lastParams.set(t.cmd, new Map(rows.map((r) => [r.k, r.hex])));

    const table = h("table", { class: "params" });
    table.createCaption().textContent =
      `cmd ${t.cmd} · ${t.encrypted ? "encrypted" : "clear"} · ${t.params.size} tags · ${t.at.toLocaleTimeString()}`;
    for (const r of rows) {
      const tr = table.insertRow();
      if (prev.size && prev.get(r.k) !== r.hex) tr.className = "changed";
      tr.insertCell().textContent = r.k.toString(16);
      tr.insertCell().textContent = r.hex;
    }
    const raw = $("solixRaw");
    let block = raw.querySelector<HTMLElement>(`[data-cmd="${t.cmd}"]`);
    if (!block) {
      block = h("div");
      block.dataset.cmd = t.cmd;
      raw.append(block);
    }
    block.replaceChildren(table);
    $("solixRawHint").hidden = true;

    if (t.fields.length) {
      fillKv($("solixDecoded"), t.fields.map((f) => [f.label, `${f.value}${f.unit ? " " + f.unit : ""}`]));
    }
  }
}
