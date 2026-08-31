const BASE = "/leak";

export function appPath(): string {
  const p = window.location.pathname;
  if (p === BASE || p === `${BASE}/`) return "/";
  if (p.startsWith(`${BASE}/`)) {
    const rest = p.slice(BASE.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return p || "/";
}

export function navigate(path: string): void {
  const dest = path.startsWith("/") ? `${BASE}${path === "/" ? "/" : path}` : path;
  window.history.pushState({}, "", dest);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
