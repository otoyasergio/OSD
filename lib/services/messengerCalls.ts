import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canUseMessenger } from "@/lib/permissions";
import { ensureVideoRoom, isTwilioVideoConfigured } from "@/lib/twilio/video";

export type ChatCall = {
  call_id: string;
  conversation_id: string;
  kind: "audio" | "video";
  twilio_room_sid: string | null;
  twilio_room_name: string;
  status: "ringing" | "active" | "ended" | "missed";
  started_by_user_id: string | null;
  started_at: string;
  ended_at: string | null;
};

const CALL_COLUMNS =
  "call_id, conversation_id, kind, twilio_room_sid, twilio_room_name, status, started_by_user_id, started_at, ended_at";

async function requireParticipant(conversationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_participant")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("NOT_A_PARTICIPANT");
  return supabase;
}

function formatDuration(startedAt: string, endedAt: string): string {
  const ms = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export async function startCall(
  conversationId: string,
  kind: "audio" | "video"
): Promise<ChatCall> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  if (!isTwilioVideoConfigured()) throw new Error("TWILIO_VIDEO_NOT_CONFIGURED");

  const supabase = await requireParticipant(conversationId, user.user_id);

  const { data: existing } = await supabase
    .from("chat_call")
    .select(CALL_COLUMNS)
    .eq("conversation_id", conversationId)
    .in("status", ["ringing", "active"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as ChatCall;

  const roomName = `conv-${conversationId}-${Date.now()}`;
  const room = await ensureVideoRoom(roomName);

  const { data: call, error } = await supabase
    .from("chat_call")
    .insert({
      conversation_id: conversationId,
      kind,
      twilio_room_name: roomName,
      twilio_room_sid: room.sid,
      status: "ringing",
      started_by_user_id: user.user_id,
    })
    .select(CALL_COLUMNS)
    .single();
  if (error) throw error;

  const label = kind === "video" ? "Video call started" : "Audio call started";
  await supabase.from("chat_message").insert({
    conversation_id: conversationId,
    sender_user_id: user.user_id,
    kind: "call_event",
    body: label,
  });

  await supabase
    .from("chat_conversation")
    .update({ last_message_at: new Date().toISOString() })
    .eq("conversation_id", conversationId);

  return call as ChatCall;
}

export async function acceptCall(callId: string): Promise<ChatCall> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data: call, error } = await supabase
    .from("chat_call")
    .select(CALL_COLUMNS)
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;
  if (!call) throw new Error("CALL_NOT_FOUND");
  if (call.status === "ended" || call.status === "missed") {
    throw new Error("CALL_ALREADY_ENDED");
  }

  await requireParticipant(call.conversation_id, user.user_id);

  if (call.status === "active") return call as ChatCall;

  const { data: updated, error: updateError } = await supabase
    .from("chat_call")
    .update({ status: "active" })
    .eq("call_id", callId)
    .select(CALL_COLUMNS)
    .single();
  if (updateError) throw updateError;
  return updated as ChatCall;
}

export async function declineCall(callId: string): Promise<void> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data: call, error } = await supabase
    .from("chat_call")
    .select(CALL_COLUMNS)
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;
  if (!call) throw new Error("CALL_NOT_FOUND");
  if (call.status === "ended" || call.status === "missed") return;

  await requireParticipant(call.conversation_id, user.user_id);

  const endedAt = new Date().toISOString();
  await supabase
    .from("chat_call")
    .update({ status: "missed", ended_at: endedAt })
    .eq("call_id", callId);

  await supabase.from("chat_message").insert({
    conversation_id: call.conversation_id,
    sender_user_id: user.user_id,
    kind: "call_event",
    body: call.kind === "video" ? "Missed video call" : "Missed audio call",
  });
}

export async function endCall(callId: string): Promise<void> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  const supabase = await createClient();

  const { data: call, error } = await supabase
    .from("chat_call")
    .select(CALL_COLUMNS)
    .eq("call_id", callId)
    .maybeSingle();
  if (error) throw error;
  if (!call) throw new Error("CALL_NOT_FOUND");
  if (call.status === "ended" || call.status === "missed") return;

  await requireParticipant(call.conversation_id, user.user_id);

  const endedAt = new Date().toISOString();
  await supabase
    .from("chat_call")
    .update({ status: "ended", ended_at: endedAt })
    .eq("call_id", callId);

  const duration = formatDuration(call.started_at, endedAt);
  const label =
    call.kind === "video" ? `Video call · ${duration}` : `Audio call · ${duration}`;

  await supabase.from("chat_message").insert({
    conversation_id: call.conversation_id,
    sender_user_id: user.user_id,
    kind: "call_event",
    body: label,
  });

  await supabase
    .from("chat_conversation")
    .update({ last_message_at: endedAt })
    .eq("conversation_id", call.conversation_id);
}

export async function getActiveCallForConversation(
  conversationId: string
): Promise<ChatCall | null> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  const supabase = await requireParticipant(conversationId, user.user_id);

  const { data, error } = await supabase
    .from("chat_call")
    .select(CALL_COLUMNS)
    .eq("conversation_id", conversationId)
    .in("status", ["ringing", "active"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ChatCall | null) ?? null;
}
