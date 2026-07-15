import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canUseMessenger } from "@/lib/permissions";
import { createVideoAccessToken, isTwilioVideoConfigured } from "@/lib/twilio/video";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!canUseMessenger(user.role)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const { call_id } = (await request.json()) as { call_id?: string };
    if (!call_id) {
      return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });
    }
    if (!isTwilioVideoConfigured()) {
      return NextResponse.json({ error: "TWILIO_VIDEO_NOT_CONFIGURED" }, { status: 503 });
    }

    const supabase = await createClient();
    const { data: call, error } = await supabase
      .from("chat_call")
      .select("call_id, conversation_id, twilio_room_name, status")
      .eq("call_id", call_id)
      .maybeSingle();
    if (error || !call) {
      return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });
    }
    if (call.status === "ended" || call.status === "missed") {
      return NextResponse.json({ error: "CALL_ALREADY_ENDED" }, { status: 409 });
    }

    const { data: membership } = await supabase
      .from("chat_participant")
      .select("user_id")
      .eq("conversation_id", call.conversation_id)
      .eq("user_id", user.user_id)
      .is("left_at", null)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: "CALL_NOT_FOUND" }, { status: 404 });
    }

    const token = createVideoAccessToken(user.user_id, call.twilio_room_name);
    return NextResponse.json({
      token,
      room_name: call.twilio_room_name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
