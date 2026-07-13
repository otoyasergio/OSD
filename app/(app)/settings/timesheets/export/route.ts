import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageTimesheets } from "@/lib/permissions";
import { exportTimesheetWeekCsv } from "@/lib/services/timeClock";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentAppUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!canManageTimesheets(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");

  try {
    const { filename, csv } = await exportTimesheetWeekCsv(week);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
