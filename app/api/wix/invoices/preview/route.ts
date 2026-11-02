import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { canCreateWorkOrder } from "@/lib/permissions/checks";
import { wixInvoicesEnabled } from "@/lib/config/features";
import { previewNextDisplayNumber } from "@/lib/services/wixInvoices";

export const runtime = "nodejs";

/** Preview only. Saving uses the display number Wix returns. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!canCreateWorkOrder(user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!wixInvoicesEnabled()) {
      return NextResponse.json({ preview: null });
    }
    const preview = await previewNextDisplayNumber();
    return NextResponse.json({ preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "NO_LOCATION") {
      return NextResponse.json({ error: "No location" }, { status: 403 });
    }
    return NextResponse.json({ preview: null });
  }
}
