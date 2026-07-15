import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions";
import { rateLimit } from "@/lib/security/rateLimit";
import {
  buildAddressSearchTerm,
  normalizeAddressSuggestions,
  normalizeGeoapifySuggestions,
} from "@/lib/address/suggestions";

export const runtime = "nodejs";

const NRCAN_GEOCODER_URL = "https://geogratis.gc.ca/services/geolocation/en/locate";
const GEOAPIFY_AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return json({ error: "Unauthorized", suggestions: [] }, 401);
  }
  if (!canViewClients(user.role)) {
    return json({ error: "Forbidden", suggestions: [] }, 403);
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 4) return json({ suggestions: [] });
  if (query.length > 160) {
    return json({ error: "Address is too long", suggestions: [] }, 400);
  }

  const limited = rateLimit({
    key: `address-suggestions:${user.user_id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.success) {
    return json({ error: "Too many requests", suggestions: [] }, 429);
  }

  const geoapifyKey = process.env.GEOAPIFY_API_KEY?.trim();

  if (geoapifyKey) {
    const url = new URL(GEOAPIFY_AUTOCOMPLETE_URL);
    url.searchParams.set("text", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("filter", "countrycode:ca");
    url.searchParams.set("bias", "proximity:-79.3832,43.6532");
    url.searchParams.set("lang", "en");
    url.searchParams.set("limit", "8");
    url.searchParams.set("apiKey", geoapifyKey);

    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Geoapify address search unavailable");

      const suggestions = normalizeGeoapifySuggestions(await response.json());
      return json({ suggestions, source: "geoapify" });
    } catch {
      // Keep customer intake usable if the free provider is temporarily unavailable.
    }
  }

  const url = new URL(NRCAN_GEOCODER_URL);
  url.searchParams.set("q", buildAddressSearchTerm(query));

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return json({ error: "Address search unavailable", suggestions: [] }, 502);
    }
    const suggestions = normalizeAddressSuggestions(await response.json());
    return json({ suggestions, source: "nrcan" });
  } catch {
    return json({ error: "Address search unavailable", suggestions: [] }, 502);
  }
}
