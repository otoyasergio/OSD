import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/database/config";
import { isPublicAppPath } from "@/lib/auth/routes";

function redirectWithSession(
  request: NextRequest,
  sessionResponse: NextResponse,
  pathname: string,
  nextPath?: string
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (nextPath) url.searchParams.set("next", nextPath);

  const redirectResponse = NextResponse.redirect(url);
  sessionResponse.cookies
    .getAll()
    .forEach((cookie) => redirectResponse.cookies.set(cookie));
  for (const name of ["expires", "pragma"]) {
    const value = sessionResponse.headers.get(name);
    if (value) redirectResponse.headers.set(name, value);
  }
  redirectResponse.headers.set("Cache-Control", "private, no-store");
  return redirectResponse;
}

const SAFE_SESSION_HEADERS = new Set(["cache-control", "expires", "pragma"]);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const config = getSupabasePublicConfig();
  const { pathname, search } = request.nextUrl;
  // Middleware redirects break the Server Actions protocol and surface as
  // "An unexpected response was received from the server."
  const isServerAction = request.headers.has("next-action");

  if (!config) {
    if (!isPublicAppPath(pathname) && !isServerAction) {
      return redirectWithSession(
        request,
        supabaseResponse,
        "/login",
        `${pathname}${search}`
      );
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        // Only forward cache headers — copying content-type (etc.) corrupts
        // Server Action / RSC responses.
        Object.entries(headers ?? {}).forEach(([name, value]) => {
          if (SAFE_SESSION_HEADERS.has(name.toLowerCase())) {
            supabaseResponse.headers.set(name, value);
          }
        });
      },
    },
  });

  // Keep this immediately after client creation. It verifies the JWT and
  // refreshes expiring auth cookies before Server Components read them.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims.sub);

  supabaseResponse.headers.set("Cache-Control", "private, no-store");

  if (isServerAction) {
    return supabaseResponse;
  }

  if (!isAuthenticated && !isPublicAppPath(pathname)) {
    return redirectWithSession(
      request,
      supabaseResponse,
      "/login",
      `${pathname}${search}`
    );
  }

  if (isAuthenticated && pathname === "/login") {
    return redirectWithSession(request, supabaseResponse, "/");
  }

  return supabaseResponse;
}
