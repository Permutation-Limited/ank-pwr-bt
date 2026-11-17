// Client-side routing between views via the URL hash (#/, #/debug). Hash
// routes need no server support, so the same build works on the dev server,
// GitHub Pages (served from a /<repo>/ subpath) or any static host. One page
// load keeps one SolixClient, so switching views never drops the connection.

interface Route { view: string; title: string }

const ROUTES: Record<string, Route> = {
  "/": { view: "view-status", title: "Power Station" },
  "/debug": { view: "view-debug", title: "Power Station · Debug" },
};

/** "#/debug" → "/debug"; anything unknown → "/". */
const current = () => {
  const path = location.hash.replace(/^#/, "") || "/";
  return ROUTES[path] ? path : "/";
};

function show() {
  const key = current();
  for (const [p, r] of Object.entries(ROUTES)) {
    const el = document.getElementById(r.view);
    if (el) el.hidden = p !== key;
  }
  document.title = ROUTES[key]!.title;
  document.querySelectorAll<HTMLAnchorElement>("header.site nav a[data-route]").forEach((a) => {
    if ((a.getAttribute("href") ?? "").replace(/^#/, "") === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

export function startRouter() {
  // Old path-style links (/debug) from before hash routing still land right.
  if (!location.hash && location.pathname.endsWith("/debug")) {
    history.replaceState(null, "", location.pathname.replace(/debug$/, "") + "#/debug");
  }
  addEventListener("hashchange", show);
  show();
}
