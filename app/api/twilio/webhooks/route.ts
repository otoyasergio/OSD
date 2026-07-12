import { NextResponse } from "next/server";
import { handleInboundSms } from "@/lib/services/communications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const from = String(form.get("From") ?? "");
  const body = String(form.get("Body") ?? "");

  if (!from || !body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    await handleInboundSms({ from, body });
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { "Content-Type": "text/xml" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
