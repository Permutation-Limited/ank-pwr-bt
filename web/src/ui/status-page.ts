// Status (home) page: battery level and power in/out. Works for any device
// model: it lays fields out by their role, never by model-specific keys.

import type { ConnectionSnapshot, SessionSnapshot, SolixClient, TelemetryEvent, TelemetryField } from "../ble";
import { $, h } from "./dom";

const num = (f?: TelemetryField) => (f && typeof f.value === "number" ? f.value : undefined);
const sum = (fs: TelemetryField[]) => fs.reduce((n, f) => n + (num(f) ?? 0), 0);
const watts = (n: number | undefined) => (n === undefined ? "—" : `${Math.round(n)} W`);

const SVG = "http://www.w3.org/2000/svg";

/** A ring gauge: track + level arc (pathLength 100, so dasharray = percent) + centered label. */
function gauge(key: string): HTMLElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("aria-hidden", "true");
  for (const cls of ["track", "level"]) {
    const c = document.createElementNS(SVG, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "60");
    c.setAttribute("cy", "60");
    c.setAttribute("r", "52");
    if (cls === "level") {
      c.setAttribute("pathLength", "100");
      c.setAttribute("stroke-dasharray", "0 100");
    }
    svg.append(c);
  }
  const el = h("div", { class: "ring", role: "img" },
    svg, h("div", { class: "ring-label" }, h("span", { class: "pct" }, "—"), h("span", { class: "pct-label" })));
  el.dataset.key = key;
  return el;
}

export class StatusPage {
  private conn: ConnectionSnapshot = { device: null, connected: false };
  private session: SessionSnapshot | null = null;
  private last: TelemetryEvent | null = null;

  constructor(client: SolixClient) {
    client.on("connection", (c) => {
      this.conn = c;
      if (!c.connected) this.last = null;
      this.render();
    });
    client.on("session", (s) => { this.session = s; this.render(); });
    client.on("telemetry", (t) => {
      if (t.fields.length) this.last = t;
      this.render();
    });
    this.render();
  }

  private render() {
    const t = this.last;
    const battery = t?.fields.find((f) => f.role === "battery");
    const live = this.conn.connected && !!t && battery !== undefined;
    $("statusEmpty").hidden = live;
    $("statusLive").hidden = !live;
    if (!live) return this.renderWaiting();

    const fields = t.fields;
    const inputs = fields.filter((f) => f.role === "input");
    const outputs = fields.filter((f) => f.role === "output");
    const totalIn = num(fields.find((f) => f.role === "input_total")) ?? sum(inputs);
    const totalOut = num(fields.find((f) => f.role === "output_total")) ?? sum(outputs);
    const temp = fields.find((f) => f.role === "temperature");

    $("statusDevice").textContent = this.conn.device?.name ?? this.session?.model.name ?? "Power station";
    $("statusMeta").textContent = [
      this.session?.model.name,
      temp ? `${temp.value}${temp.unit ?? ""}` : undefined,
      `updated ${t.at.toLocaleTimeString()}`,
    ].filter(Boolean).join(" · ");

    // One gauge per battery: the main pack, then any expansion packs.
    const packs = [battery, ...fields.filter((f) => f.role === "expansion_battery")];
    this.renderGauges(packs);
    const allFull = packs.every((f) => (num(f) ?? 0) >= 100);

    // Flow summary
    const net = totalIn - totalOut;
    const flow = $("flowState");
    const state = totalIn > totalOut && totalIn > 0 ? "charging" : totalOut > totalIn ? "discharging" : "idle";
    flow.dataset.state = state;
    flow.textContent = state === "charging" ? (allFull ? "Full, on input power" : "Charging")
      : state === "discharging" ? "Discharging" : "Idle";
    $("netWatts").textContent = `${net > 0 ? "+" : net < 0 ? "−" : ""}${Math.abs(Math.round(net))} W`;
    $("totalIn").textContent = watts(totalIn);
    $("totalOut").textContent = watts(totalOut);
    $("inTotalBig").textContent = watts(totalIn);
    $("outTotalBig").textContent = watts(totalOut);

    this.renderPorts($("inputs"), inputs, totalIn, "No inputs reported");
    this.renderPorts($("outputs"), outputs, totalOut, "No outputs reported");
  }

  /**
   * Gauges are keyed by field and reused across readings so the arcs animate.
   * With one pack the gauge reads "battery"; with several, "main" / "expansion".
   */
  private renderGauges(packs: TelemetryField[]) {
    const root = $("gauges");
    const multi = packs.length > 1;
    root.classList.toggle("multi", multi);
    const keep = new Set(packs.map((f) => f.key));
    for (const el of [...root.children] as HTMLElement[]) if (!keep.has(el.dataset.key!)) el.remove();

    packs.forEach((f, i) => {
      let g = root.querySelector<HTMLElement>(`[data-key="${f.key}"]`);
      if (!g) {
        g = gauge(f.key);
        root.append(g);
      }
      if (root.children[i] !== g) root.insertBefore(g, root.children[i] ?? null);
      const pct = Math.max(0, Math.min(100, num(f) ?? 0));
      const name = !multi ? "battery" : f.role === "battery" ? "main" : "expansion";
      g.classList.toggle("secondary", i > 0);
      g.dataset.level = pct <= 20 ? "low" : pct <= 50 ? "mid" : "high";
      g.setAttribute("aria-label", `${multi ? name[0]!.toUpperCase() + name.slice(1) + " battery" : "Battery"} ${Math.round(pct)} percent`);
      g.querySelector(".level")!.setAttribute("stroke-dasharray", `${pct} 100`);
      g.querySelector(".pct")!.replaceChildren(String(Math.round(pct)), h("small", {}, "%"));
      g.querySelector(".pct-label")!.textContent = name;
    });
  }

  private renderPorts(list: HTMLElement, ports: TelemetryField[], total: number, emptyText: string) {
    if (!ports.length) {
      list.replaceChildren(h("li", { class: "port idle" }, h("span", { class: "label" }, emptyText)));
      return;
    }
    // Active ports first, then by power; idle ones stay listed but muted.
    const sorted = [...ports].sort((a, b) => (num(b) ?? 0) - (num(a) ?? 0));
    list.replaceChildren(...sorted.map((f) => {
      const w = num(f) ?? 0;
      const share = total > 0 ? Math.min(100, (w / total) * 100) : 0;
      const bar = h("span");
      bar.style.width = `${share}%`;
      return h("li", { class: w > 0 ? "port" : "port idle" },
        h("span", { class: "label" }, f.label),
        h("span", { class: "watts" }, watts(w)),
        h("div", { class: "bar", "aria-hidden": "true" }, bar));
    }));
  }

  private renderWaiting() {
    const msg = $("statusWaiting");
    const s = this.session?.state;
    let text = "";
    if (this.conn.device && !this.conn.connected) text = "Disconnected. Click Connect at the top to resume.";
    else if (this.conn.connected) {
      if (s === "awaiting-confirmation") text = "Approve this browser on the power station: short-press its power or IoT button.";
      else if (s === "authorized") text = this.session?.model.id === "solix-generic"
        ? "Connected, but this model's telemetry isn't decoded yet. See Debug for the raw data."
        : "Connected. Waiting for the first reading…";
      else if (s === "failed" || s === "unsupported") text = "This device didn't complete a SOLIX session. See Debug for details.";
      else text = "Connecting…";
    }
    msg.hidden = !text;
    msg.textContent = text;
  }
}
