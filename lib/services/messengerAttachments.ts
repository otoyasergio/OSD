import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { canUseMessenger } from "@/lib/permissions";
import { randomUUID } from "crypto";

const BUCKET = "chat-media";
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
]);

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

function extensionFor(mime: string, fallback: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  if (mime === "audio/webm") return "webm";
  if (mime === "audio/mp4") return "m4a";
  if (mime === "audio/mpeg") return "mp3";
  if (mime === "audio/aac") return "aac";
  return fallback;
}

async function uploadAttachment(
  conversationId: string,
  file: File,
  kind: "image" | "audio",
  durationMs?: number
) {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");

  if (file.size > MAX_BYTES) throw new Error("ATTACHMENT_TOO_LARGE");
  const allowed = kind === "image" ? ALLOWED_IMAGE_TYPES : ALLOWED_AUDIO_TYPES;
  if (!allowed.has(file.type)) throw new Error("ATTACHMENT_TYPE_INVALID");

  const supabase = await requireParticipant(conversationId, user.user_id);
  const messageId = randomUUID();
  const ext = extensionFor(file.type, kind === "image" ? "bin" : "webm");
  const storagePath = `${conversationId}/${messageId}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw new Error("ATTACHMENT_UPLOAD_FAILED");

  const { data: message, error: messageError } = await supabase
    .from("chat_message")
    .insert({
      message_id: messageId,
      conversation_id: conversationId,
      sender_user_id: user.user_id,
      kind,
      body: kind === "image" ? "Photo" : "Voice note",
    })
    .select(
      "message_id, conversation_id, sender_user_id, kind, body, reply_to_message_id, edited_at, unsent_at, created_at"
    )
    .single();

  if (messageError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw messageError;
  }

  const { error: attachmentError } = await supabase.from("chat_attachment").insert({
    message_id: messageId,
    storage_path: storagePath,
    mime_type: file.type,
    bytes: file.size,
    duration_ms: durationMs ?? null,
  });

  if (attachmentError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw attachmentError;
  }

  await supabase
    .from("chat_conversation")
    .update({ last_message_at: message.created_at })
    .eq("conversation_id", conversationId);

  await supabase
    .from("chat_participant")
    .update({ last_read_at: message.created_at, hidden_at: null })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);

  return message;
}

export async function uploadChatImage(conversationId: string, file: File) {
  return uploadAttachment(conversationId, file, "image");
}

export async function uploadVoiceNote(
  conversationId: string,
  file: File,
  durationMs: number
) {
  return uploadAttachment(conversationId, file, "audio", durationMs);
}

export async function signChatAttachmentPaths(
  paths: string[],
  conversationId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const allowed = paths.filter((p) => p.startsWith(`${conversationId}/`));
  if (allowed.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(allowed, 60 * 60);
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) {
      map.set(item.path, item.signedUrl);
    }
  }
  return map;
}
