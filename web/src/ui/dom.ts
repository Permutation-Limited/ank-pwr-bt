// Tiny DOM helpers shared by the panels.

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c);
  return el;
}

export function fillKv(dl: HTMLElement, rows: [string, string][]) {
  dl.replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

export function setPill(el: HTMLElement, text: string, tone: "" | "ok" | "bad" | "warn") {
  el.textContent = text;
  el.className = `pill ${tone}`.trim();
}
