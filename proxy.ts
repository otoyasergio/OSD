import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // /api is excluded: every API route authenticates itself (webhook
  // signatures, cron bearer, requireUser), so running getClaims() session
  // refresh in middleware only added a Supabase Auth round trip to every
  // Twilio/Square/Wix webhook and cron invocation.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
