import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions";
import { rateLimit } from "@/lib/security/rateLimit";
import { searchCustomers } from "@/lib/services/customers";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * Fast typeahead for invoice / work-order customer pickers.
 * Shop customers (bike or WO) rank first; Wix-only contacts require 2+ characters.
 */
export async function GET(request: NextRequest) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return json({ error: "Unauthorized", customers: [] }, 401);
  }
  if (!canViewClients(user.role)) {
    return json({ error: "Forbidden", customers: [] }, 403);
  }

  const limited = rateLimit({
    key: `customer-search:${user.user_id}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limited.success) return json({ error: "Too many requests", customers: [] }, 429);

  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (query.length > 80) {
    return json({ error: "Query too long", customers: [] }, 400);
  }

  try {
    const customers = await searchCustomers(query, { preferShopCustomers: true });
    return json({ customers });
  } catch {
    return json({ error: "Search unavailable", customers: [] }, 502);
  }
}
