// Service worker: network-first with an offline fallback.
//
// Online, every request is checked with the server, so a deploy shows up on
// the next load. Each successful response is
// also saved, and when the network fails the saved copy is served instead, so
// the installed app still opens offline (Web Bluetooth needs no internet).
//
// Paths are relative to this file, so it works on localhost and under
// GitHub Pages' /<repo>/ subpath alike.

const CACHE = "power-station";

// Saved on install, so the app works offline after a single visit: the first
// page load happens before this worker controls the page and isn't saved.
const SHELL = [
  "./",
  "app.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, event));
});

async function networkFirst(request, event) {
  try {
    // "no-cache" revalidates with the server (a cheap 304 when unchanged)
    // instead of trusting the HTTP cache, which on GitHub Pages could hold a
    // pre-deploy copy for up to 10 minutes.
    const response = await fetch(new Request(request, { cache: "no-cache" }));
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  } catch (err) {
    const cached =
      (await caches.match(request, { ignoreSearch: true })) ??
      (request.mode === "navigate" ? await caches.match("./") : undefined);
    if (cached) return cached;
    throw err;
  }
}
