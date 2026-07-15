import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions";
import { createClient } from "@/lib/database/supabase-server";
import { rateLimit } from "@/lib/security/rateLimit";
import { normalizeEmailInput } from "@/lib/email/normalize";
import {
  buildPhoneLookupVariants,
  mergeDuplicateCandidates,
  type DuplicateCustomerCandidate,
} from "@/lib/customers/duplicates";

export const runtime = "nodejs";

const COLUMNS = "customer_id, first_name, last_name, phone, email";

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
    return json({ error: "Unauthorized", matches: [] }, 401);
  }
  if (!canViewClients(user.role)) {
    return json({ error: "Forbidden", matches: [] }, 403);
  }

  const limited = rateLimit({
    key: `customer-duplicate-check:${user.user_id}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.success) return json({ error: "Too many requests", matches: [] }, 429);

  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  const email = normalizeEmailInput(request.nextUrl.searchParams.get("email"));
  const excludeId = request.nextUrl.searchParams.get("exclude")?.trim() ?? "";
  if (phone.length > 80 || email.length > 320 || excludeId.length > 80) {
    return json({ error: "Invalid contact details", matches: [] }, 400);
  }
  if (
    excludeId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      excludeId
    )
  ) {
    return json({ error: "Invalid customer", matches: [] }, 400);
  }

  const phoneVariants = buildPhoneLookupVariants(phone);
  if (!email && phoneVariants.length === 0) return json({ matches: [] });

  const supabase = await createClient();
  const emailLookup = async (): Promise<DuplicateCustomerCandidate[]> => {
    if (!email) return [];
    let query = supabase.from("customer").select(COLUMNS).ilike("email", email);
    if (excludeId) query = query.neq("customer_id", excludeId);
    const { data, error } = await query.limit(20);
    if (error) throw error;
    return (data ?? []) as DuplicateCustomerCandidate[];
  };
  const phoneLookup = async (): Promise<DuplicateCustomerCandidate[]> => {
    if (phoneVariants.length === 0) return [];
    let query = supabase.from("customer").select(COLUMNS).in("phone", phoneVariants);
    if (excludeId) query = query.neq("customer_id", excludeId);
    const { data, error } = await query.limit(20);
    if (error) throw error;
    return (data ?? []) as DuplicateCustomerCandidate[];
  };

  try {
    const [emailRows, phoneRows] = await Promise.all([emailLookup(), phoneLookup()]);
    const matches = mergeDuplicateCandidates({ emailRows, phoneRows, email, phone });
    return json({ matches });
  } catch {
    return json({ error: "Duplicate check unavailable", matches: [] }, 502);
  }
}
