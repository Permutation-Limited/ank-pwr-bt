// Enforces the layering described in main.ts:
//   protocol/ -> nothing browser-specific, never imports ble/ or ui/
//   ble/      -> may import protocol/, never ui/, never touches the DOM
//   ui/       -> imports the BLE layer only through ble/index.ts, never protocol/

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = import.meta.dir;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return sources(rel);
    return rel.endsWith(".ts") && !rel.endsWith(".test.ts") && !rel.endsWith(".d.ts") ? [rel] : [];
  });
}

const imports = (src: string) => [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
const resolve = (file: string, spec: string) =>
  spec.startsWith(".") ? relative(ROOT, join(ROOT, file, "..", spec)) : spec;
const code = (src: string) => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("layering", () => {
  test("protocol/ is DOM- and Web-Bluetooth-free", () => {
    for (const f of sources("protocol")) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect({ f, dom: /\b(document|window)\./.test(code(src)), bt: /navigator\.bluetooth/.test(code(src)) })
        .toEqual({ f, dom: false, bt: false });
      for (const spec of imports(src)) {
        expect({ f, target: resolve(f, spec) }).not.toEqual(
          expect.objectContaining({ target: expect.stringMatching(/^(ble|ui)(\/|$)/) }));
      }
    }
  });

  test("ble/ never touches the DOM or imports ui/", () => {
    for (const f of sources("ble")) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect({ f, dom: /\bdocument\./.test(code(src)) }).toEqual({ f, dom: false });
      for (const spec of imports(src)) expect({ f, target: resolve(f, spec).startsWith("ui") }).toEqual({ f, target: false });
    }
  });

  test("ui/ uses only ble/index.ts", () => {
    for (const f of sources("ui")) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const spec of imports(src)) {
        const target = resolve(f, spec);
        const ok = target.startsWith("ui/") || target === "ble";
        expect({ f, spec, ok }).toEqual({ f, spec, ok: true });
      }
    }
  });
});
