// Hash routes (#/, #/debug): no server support needed, so the same build
// works on the dev server and on GitHub Pages' /<repo>/ subpath.

import { useEffect, useSyncExternalStore } from "react";

export type Route = "status" | "debug";

const read = (): Route => (location.hash.replace(/^#/, "") === "/debug" ? "debug" : "status");
const subscribe = (fn: () => void) => {
  addEventListener("hashchange", fn);
  return () => removeEventListener("hashchange", fn);
};

export const ROUTE_HREF: Record<Route, string> = { status: "#/", debug: "#/debug" };

export function useRoute(): Route {
  const route = useSyncExternalStore(subscribe, read);
  useEffect(() => {
    document.title = route === "debug" ? "Power Station · Debug" : "Power Station";
  }, [route]);
  return route;
}

/** Old path-style links (/debug) from before hash routing still land right. */
export function migrateLegacyPath() {
  if (!location.hash && location.pathname.endsWith("/debug")) {
    history.replaceState(null, "", location.pathname.replace(/debug$/, "") + "#/debug");
  }
}
