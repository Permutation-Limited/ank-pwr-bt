import type { LogLevel } from "../ble";
import { h } from "./dom";

export class LogPanel {
  constructor(private readonly pre: HTMLElement) {}

  add(message: string, level: LogLevel = "info") {
    const cls = level === "info" ? {} : { class: level };
    this.pre.append(h("span", cls, `${new Date().toISOString().slice(11, 23)}  ${message}\n`));
    this.pre.scrollTop = this.pre.scrollHeight;
    (level === "err" ? console.error : console.log)(message);
  }

  clear() { this.pre.replaceChildren(); }
}
