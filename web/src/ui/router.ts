// Client-side routing between views. One page load keeps one SolixClient, so
// switching views never drops the Bluetooth connection. The dev server falls
// back to index.html for unknown paths, so /debug works on reload too.

interface Route { view: string; title: string }

const ROUTES: Record<string, Route> = {
  "/": { view: "view-status", title: "Power Station" },
  "/debug": { view: "view-debug", title: "Power Station · Debug" },
};

function show(path: string) {
  const key = ROUTES[path] ? path : "/";
  for (const [p, r] of Object.entries(ROUTES)) {
    const el = document.getElementById(r.view);
    if (el) el.hidden = p !== key;
  }
  document.title = ROUTES[key]!.title;
  document.querySelectorAll<HTMLAnchorElement>("header.site nav a[data-route]").forEach((a) => {
    if (new URL(a.href).pathname === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

export function startRouter() {
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>("a[data-route]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    if (url.pathname !== location.pathname) history.pushState(null, "", url.pathname);
    show(url.pathname);
  });
  addEventListener("popstate", () => show(location.pathname));
  show(location.pathname);
}
