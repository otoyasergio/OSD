const APP_ORIGIN = "https://app.local";

/** Routes that deliberately do not require a staff Supabase session. */
export function isPublicAppPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/c" ||
    pathname.startsWith("/c/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

/** Prevent the login `next` parameter from becoming an open redirect. */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN) return "/";
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
