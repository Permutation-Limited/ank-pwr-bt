// Enforces the layering described in main.tsx:
//   protocol/ -> no DOM, no Web Bluetooth, no npm packages; never imports ble/ or ui/
//   ble/      -> may import protocol/; no DOM, no npm packages; never imports ui/
//   ui/       -> React/MUI and the BLE layer through ble/index.ts only; never protocol/

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";

/** The source tree, wherever Bazel's runfiles (or a plain checkout) put it. */
const ROOT = [
  process.env.JS_BINARY__RUNFILES && join(process.env.JS_BINARY__RUNFILES, "_main/web/src"),
  join(process.cwd(), "web/src"),
  join(process.cwd(), "src"),
].find((p): p is string => !!p && existsSync(join(p, "main.tsx")));

function sources(dir: string): string[] {
  return readdirSync(join(ROOT!, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT!, rel)).isDirectory()) return sources(rel);
    return /\.tsx?$/.test(rel) && !/\.(test|d)\.ts$/.test(rel) ? [rel] : [];
  });
}

const imports = (src: string) => [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
const resolve = (file: string, spec: string) =>
  spec.startsWith(".") ? relative(ROOT!, join(ROOT!, file, "..", spec)) : spec;
const code = (src: string) => src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const read = (f: string) => readFileSync(join(ROOT!, f), "utf8");

describe("layering", () => {
  test("source tree found", () => {
    assert.ok(ROOT, "could not locate web/src");
    assert.ok(sources("ui").length > 0);
  });

  test("protocol/ is DOM-, Web-Bluetooth- and npm-free", () => {
    for (const f of sources("protocol")) {
      const src = code(read(f));
      assert.ok(!/\b(document|window)\./.test(src), `${f} touches the DOM`);
      assert.ok(!/navigator\.bluetooth/.test(src), `${f} uses Web Bluetooth`);
      for (const spec of imports(src)) {
        const target = resolve(f, spec);
        assert.ok(spec.startsWith("."), `${f} imports npm package ${spec}`);
        assert.ok(!/^(ble|ui)(\/|$)/.test(target), `${f} imports ${target}`);
      }
    }
  });

  test("ble/ never touches the DOM, npm packages or ui/", () => {
    for (const f of sources("ble")) {
      const src = code(read(f));
      assert.ok(!/\bdocument\./.test(src), `${f} touches the DOM`);
      for (const spec of imports(src)) {
        assert.ok(spec.startsWith("."), `${f} imports npm package ${spec}`);
        assert.ok(!resolve(f, spec).startsWith("ui"), `${f} imports ui/`);
      }
    }
  });

  test("ui/ reaches the BLE layer only through ble/index.ts", () => {
    for (const f of [...sources("ui"), "main.tsx"]) {
      for (const spec of imports(read(f))) {
        if (!spec.startsWith(".")) continue; // react, @mui/*, @emotion/*
        const target = resolve(f, spec);
        const ok = target.startsWith("ui/") || target === "ble";
        assert.ok(ok, `${f} imports ${spec} (only ble/index.ts and ui/ are allowed)`);
      }
    }
  });
});
