// Minimal static file server for the built single-page app.
// localhost counts as a secure context, so Web Bluetooth works without TLS.
import { join, normalize } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: serve.ts <site-dir> [--port N]");
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag > 0 ? process.argv[portFlag + 1] : process.env.PORT ?? 8080);

const server = Bun.serve({
  port,
  hostname: "localhost",
  async fetch(req) {
    const url = new URL(req.url);
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(join(root, path));
    if (await file.exists()) {
      return new Response(file, { headers: { "Cache-Control": "no-store" } });
    }
    // SPA fallback
    return new Response(Bun.file(join(root, "index.html")), {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
    });
  },
});

console.log(`Serving ${root}\n  → http://localhost:${server.port}  (open in Chrome)`);
