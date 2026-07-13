import { requireUser, type AppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { canManageGroupMembers, canUseMessenger } from "@/lib/permissions";
import { buildDmKey } from "@/lib/messenger/dmKey";
import { canUnsendMessage } from "@/lib/messenger/unsendWindow";

export type ConversationParticipant = {
  user_id: string;
  first_name: string;
  last_name: string;
  last_read_at: string | null;
  muted_at: string | null;
  pinned_at: string | null;
  hidden_at: string | null;
  left_at: string | null;
};

export type Conversation = {
  conversation_id: string;
  type: "dm" | "group";
  title: string | null;
  dm_key: string | null;
  created_by_user_id: string | null;
  last_message_at: string | null;
  created_at: string;
  participants: ConversationParticipant[];
  last_message_preview: string | null;
  unread: boolean;
  display_name: string;
};

export type ChatReaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type ChatAttachment = {
  attachment_id: string;
  message_id: string;
  storage_path: string;
  mime_type: string;
  bytes: number | null;
  duration_ms: number | null;
  signed_url?: string | null;
};

export type ChatMessage = {
  message_id: string;
  conversation_id: string;
  sender_user_id: string | null;
  kind: string;
  body: string | null;
  reply_to_message_id: string | null;
  edited_at: string | null;
  unsent_at: string | null;
  created_at: string;
  sender?: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
  reply_to?: {
    message_id: string;
    body: string | null;
    kind: string;
    sender_user_id: string | null;
  } | null;
  reactions: ChatReaction[];
  attachments: ChatAttachment[];
};

const CONVERSATION_COLUMNS =
  "conversation_id, type, title, dm_key, created_by_user_id, last_message_at, created_at";

const MESSAGE_COLUMNS =
  "message_id, conversation_id, sender_user_id, kind, body, reply_to_message_id, edited_at, unsent_at, created_at";

async function requireMessengerUser(): Promise<AppUser> {
  const user = await requireUser();
  if (!canUseMessenger(user.role)) throw new Error("FORBIDDEN");
  return user;
}

async function requireParticipant(
  supabase: DbClient,
  conversationId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from("chat_participant")
    .select("conversation_id, user_id, left_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.left_at) throw new Error("NOT_A_PARTICIPANT");
  return data;
}

function participantName(p: { first_name: string; last_name: string }): string {
  return `${p.first_name} ${p.last_name}`.trim();
}

function displayNameFor(
  conversation: {
    type: string;
    title: string | null;
  },
  participants: ConversationParticipant[],
  currentUserId: string
): string {
  if (conversation.type === "group") {
    return conversation.title?.trim() || "Group chat";
  }
  const other = participants.find((p) => p.user_id !== currentUserId);
  return other ? participantName(other) : "Direct message";
}

async function loadParticipants(
  supabase: DbClient,
  conversationIds: string[]
): Promise<Map<string, ConversationParticipant[]>> {
  const map = new Map<string, ConversationParticipant[]>();
  if (conversationIds.length === 0) return map;

  const { data, error } = await supabase
    .from("chat_participant")
    .select(
      `
      conversation_id,
      user_id,
      last_read_at,
      muted_at,
      pinned_at,
      hidden_at,
      left_at,
      app_user:user_id ( first_name, last_name )
    `
    )
    .in("conversation_id", conversationIds)
    .is("left_at", null);
  if (error) throw error;

  for (const row of data ?? []) {
    const user = Array.isArray(row.app_user) ? row.app_user[0] : row.app_user;
    const list = map.get(row.conversation_id) ?? [];
    list.push({
      user_id: row.user_id,
      first_name: (user as { first_name: string } | null)?.first_name ?? "",
      last_name: (user as { last_name: string } | null)?.last_name ?? "",
      last_read_at: row.last_read_at,
      muted_at: row.muted_at,
      pinned_at: row.pinned_at,
      hidden_at: row.hidden_at,
      left_at: row.left_at,
    });
    map.set(row.conversation_id, list);
  }
  return map;
}

export async function listConversations(): Promise<Conversation[]> {
  const user = await requireMessengerUser();
  const supabase = await createClient();

  const { data: memberships, error: membershipError } = await supabase
    .from("chat_participant")
    .select("conversation_id, last_read_at, muted_at, pinned_at, hidden_at, left_at")
    .eq("user_id", user.user_id)
    .is("left_at", null);
  if (membershipError) throw membershipError;

  const visible = (memberships ?? []).filter((m) => !m.hidden_at);
  if (visible.length === 0) return [];

  const conversationIds = visible.map((m) => m.conversation_id);
  const membershipById = new Map(visible.map((m) => [m.conversation_id, m]));

  const { data: conversations, error } = await supabase
    .from("chat_conversation")
    .select(CONVERSATION_COLUMNS)
    .in("conversation_id", conversationIds)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw error;

  const participantsByConv = await loadParticipants(supabase, conversationIds);

  const { data: lastMessages, error: lastError } = await supabase
    .from("chat_message")
    .select("conversation_id, body, kind, unsent_at, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false })
    .limit(Math.max(conversationIds.length * 3, 50));
  if (lastError) throw lastError;

  const previewByConv = new Map<string, string | null>();
  for (const msg of lastMessages ?? []) {
    if (previewByConv.has(msg.conversation_id)) continue;
    if (msg.unsent_at) {
      previewByConv.set(msg.conversation_id, "Message unsent");
    } else if (msg.kind === "image") {
      previewByConv.set(msg.conversation_id, "Photo");
    } else if (msg.kind === "audio") {
      previewByConv.set(msg.conversation_id, "Voice note");
    } else {
      previewByConv.set(msg.conversation_id, msg.body);
    }
  }

  const result: Conversation[] = (conversations ?? []).map((c) => {
    const membership = membershipById.get(c.conversation_id)!;
    const participants = participantsByConv.get(c.conversation_id) ?? [];
    const lastAt = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
    const readAt = membership.last_read_at
      ? new Date(membership.last_read_at).getTime()
      : 0;
    const unread = Boolean(lastAt && lastAt > readAt);
    return {
      conversation_id: c.conversation_id,
      type: c.type as "dm" | "group",
      title: c.title,
      dm_key: c.dm_key,
      created_by_user_id: c.created_by_user_id,
      last_message_at: c.last_message_at,
      created_at: c.created_at,
      participants,
      last_message_preview: previewByConv.get(c.conversation_id) ?? null,
      unread: unread && !membership.muted_at,
      display_name: displayNameFor(c, participants, user.user_id),
    };
  });

  result.sort((a, b) => {
    const aPinned = membershipById.get(a.conversation_id)?.pinned_at;
    const bPinned = membershipById.get(b.conversation_id)?.pinned_at;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) {
      return new Date(bPinned).getTime() - new Date(aPinned).getTime();
    }
    const aTime = a.last_message_at ?? a.created_at;
    const bTime = b.last_message_at ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return result;
}

export async function getConversation(conversationId: string): Promise<Conversation> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { data, error } = await supabase
    .from("chat_conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CONVERSATION_NOT_FOUND");

  const participantsByConv = await loadParticipants(supabase, [conversationId]);
  const participants = participantsByConv.get(conversationId) ?? [];

  return {
    conversation_id: data.conversation_id,
    type: data.type as "dm" | "group",
    title: data.title,
    dm_key: data.dm_key,
    created_by_user_id: data.created_by_user_id,
    last_message_at: data.last_message_at,
    created_at: data.created_at,
    participants,
    last_message_preview: null,
    unread: false,
    display_name: displayNameFor(data, participants, user.user_id),
  };
}

export async function startDirectMessage(otherUserId: string): Promise<Conversation> {
  const user = await requireMessengerUser();
  if (otherUserId === user.user_id) throw new Error("SELF_DM_NOT_ALLOWED");

  const supabase = await createClient();
  const dmKey = buildDmKey(user.user_id, otherUserId);

  const { data: existing, error: findError } = await supabase
    .from("chat_conversation")
    .select(CONVERSATION_COLUMNS)
    .eq("dm_key", dmKey)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) {
    // Unhide for current user if previously deleted-for-me
    await supabase
      .from("chat_participant")
      .update({ hidden_at: null })
      .eq("conversation_id", existing.conversation_id)
      .eq("user_id", user.user_id);
    return getConversation(existing.conversation_id);
  }

  const { data: created, error: insertError } = await supabase
    .from("chat_conversation")
    .insert({
      type: "dm",
      dm_key: dmKey,
      created_by_user_id: user.user_id,
    })
    .select(CONVERSATION_COLUMNS)
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: raceWinner, error: reselectError } = await supabase
        .from("chat_conversation")
        .select(CONVERSATION_COLUMNS)
        .eq("dm_key", dmKey)
        .single();
      if (reselectError) throw reselectError;
      return getConversation(raceWinner.conversation_id);
    }
    throw insertError;
  }

  // Insert self first so is_chat_participant() passes for the peer row.
  const { error: selfError } = await supabase.from("chat_participant").insert({
    conversation_id: created.conversation_id,
    user_id: user.user_id,
  });
  if (selfError) throw selfError;

  const { error: peerError } = await supabase.from("chat_participant").insert({
    conversation_id: created.conversation_id,
    user_id: otherUserId,
  });
  if (peerError) throw peerError;

  return getConversation(created.conversation_id);
}

export async function createGroup(input: {
  title: string;
  memberUserIds: string[];
}): Promise<Conversation> {
  const user = await requireMessengerUser();
  const members = [...new Set(input.memberUserIds)].filter((id) => id !== user.user_id);
  if (members.length === 0) throw new Error("RECIPIENT_REQUIRED");

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("chat_conversation")
    .insert({
      type: "group",
      title: input.title.trim() || "Group chat",
      created_by_user_id: user.user_id,
    })
    .select(CONVERSATION_COLUMNS)
    .single();
  if (error) throw error;

  const { error: selfError } = await supabase.from("chat_participant").insert({
    conversation_id: created.conversation_id,
    user_id: user.user_id,
  });
  if (selfError) throw selfError;

  const { error: memberError } = await supabase.from("chat_participant").insert(
    members.map((user_id) => ({
      conversation_id: created.conversation_id,
      user_id,
    }))
  );
  if (memberError) throw memberError;

  return getConversation(created.conversation_id);
}

export async function addGroupMembers(
  conversationId: string,
  memberUserIds: string[]
): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  const conversation = await getConversation(conversationId);
  if (conversation.type !== "group") throw new Error("FORBIDDEN");
  const isCreator = conversation.created_by_user_id === user.user_id;
  if (!canManageGroupMembers(user.role, isCreator)) {
    throw new Error("FORBIDDEN");
  }

  const existing = new Set(conversation.participants.map((p) => p.user_id));
  const toAdd = [...new Set(memberUserIds)].filter((id) => !existing.has(id));
  if (toAdd.length === 0) return;

  for (const user_id of toAdd) {
    const { data: prior } = await supabase
      .from("chat_participant")
      .select("user_id, left_at")
      .eq("conversation_id", conversationId)
      .eq("user_id", user_id)
      .maybeSingle();

    if (prior?.left_at) {
      const { error } = await supabase
        .from("chat_participant")
        .update({ left_at: null, joined_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", user_id);
      if (error) throw error;
    } else if (!prior) {
      const { error } = await supabase.from("chat_participant").insert({
        conversation_id: conversationId,
        user_id,
      });
      if (error) throw error;
    }
  }
}

export async function removeGroupMember(
  conversationId: string,
  memberUserId: string
): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  const conversation = await getConversation(conversationId);
  if (conversation.type !== "group") throw new Error("FORBIDDEN");
  const isCreator = conversation.created_by_user_id === user.user_id;
  if (memberUserId !== user.user_id && !canManageGroupMembers(user.role, isCreator)) {
    throw new Error("FORBIDDEN");
  }

  const { error } = await supabase
    .from("chat_participant")
    .update({ left_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", memberUserId);
  if (error) throw error;
}

export async function listMessages(
  conversationId: string,
  limit = 100
): Promise<ChatMessage[]> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { data, error } = await supabase
    .from("chat_message")
    .select(
      `
      ${MESSAGE_COLUMNS},
      sender:sender_user_id ( user_id, first_name, last_name ),
      reply_to:reply_to_message_id ( message_id, body, kind, sender_user_id )
    `
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = [...(data ?? [])].reverse();
  const messageIds = rows.map((m) => m.message_id);
  const reactionsByMessage = new Map<string, ChatReaction[]>();
  const attachmentsByMessage = new Map<string, ChatAttachment[]>();

  if (messageIds.length > 0) {
    const { data: reactions } = await supabase
      .from("chat_reaction")
      .select("message_id, user_id, emoji, created_at")
      .in("message_id", messageIds);
    for (const r of reactions ?? []) {
      const list = reactionsByMessage.get(r.message_id) ?? [];
      list.push(r as ChatReaction);
      reactionsByMessage.set(r.message_id, list);
    }

    const { data: attachments } = await supabase
      .from("chat_attachment")
      .select("attachment_id, message_id, storage_path, mime_type, bytes, duration_ms")
      .in("message_id", messageIds);
    for (const a of attachments ?? []) {
      const list = attachmentsByMessage.get(a.message_id) ?? [];
      list.push(a as ChatAttachment);
      attachmentsByMessage.set(a.message_id, list);
    }
  }

  return rows.map((row) => {
    const sender = Array.isArray(row.sender) ? row.sender[0] : row.sender;
    const replyTo = Array.isArray(row.reply_to) ? row.reply_to[0] : row.reply_to;
    return {
      message_id: row.message_id,
      conversation_id: row.conversation_id,
      sender_user_id: row.sender_user_id,
      kind: row.kind,
      body: row.body,
      reply_to_message_id: row.reply_to_message_id,
      edited_at: row.edited_at,
      unsent_at: row.unsent_at,
      created_at: row.created_at,
      sender: sender as ChatMessage["sender"],
      reply_to: replyTo as ChatMessage["reply_to"],
      reactions: reactionsByMessage.get(row.message_id) ?? [],
      attachments: attachmentsByMessage.get(row.message_id) ?? [],
    };
  });
}

export async function sendTextMessage(
  conversationId: string,
  body: string,
  replyToMessageId?: string | null
): Promise<ChatMessage> {
  const user = await requireMessengerUser();
  const text = body.trim();
  if (!text) throw new Error("NOTE_REQUIRED");

  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { data, error } = await supabase
    .from("chat_message")
    .insert({
      conversation_id: conversationId,
      sender_user_id: user.user_id,
      kind: "text",
      body: text,
      reply_to_message_id: replyToMessageId || null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;

  await supabase
    .from("chat_conversation")
    .update({ last_message_at: data.created_at })
    .eq("conversation_id", conversationId);

  // Sender has read their own send — avoid self-unread badges.
  await supabase
    .from("chat_participant")
    .update({ last_read_at: data.created_at, hidden_at: null })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);

  return {
    ...data,
    reactions: [],
    attachments: [],
    sender: {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
    },
    reply_to: null,
  };
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { error } = await supabase
    .from("chat_participant")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);
  if (error) throw error;
}

export async function toggleReaction(messageId: string, emoji: string): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();

  const { data: message, error } = await supabase
    .from("chat_message")
    .select("message_id, conversation_id")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error("MESSAGE_NOT_FOUND");
  await requireParticipant(supabase, message.conversation_id, user.user_id);

  const { data: existing } = await supabase
    .from("chat_reaction")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("user_id", user.user_id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    const { error: delError } = await supabase
      .from("chat_reaction")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", user.user_id)
      .eq("emoji", emoji);
    if (delError) throw delError;
  } else {
    const { error: insError } = await supabase.from("chat_reaction").insert({
      message_id: messageId,
      user_id: user.user_id,
      emoji,
    });
    if (insError) throw insError;
  }
}

export async function editMessage(messageId: string, body: string): Promise<void> {
  const user = await requireMessengerUser();
  const text = body.trim();
  if (!text) throw new Error("NOTE_REQUIRED");

  const supabase = await createClient();
  const { data: message, error } = await supabase
    .from("chat_message")
    .select("message_id, sender_user_id, kind, unsent_at")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error("MESSAGE_NOT_FOUND");
  if (message.sender_user_id !== user.user_id) throw new Error("NOT_MESSAGE_SENDER");
  if (message.unsent_at) throw new Error("MESSAGE_NOT_FOUND");
  if (message.kind !== "text") throw new Error("MESSAGE_NOT_FOUND");

  const { error: updateError } = await supabase
    .from("chat_message")
    .update({ body: text, edited_at: new Date().toISOString() })
    .eq("message_id", messageId);
  if (updateError) throw updateError;
}

export async function unsendMessage(messageId: string): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  const { data: message, error } = await supabase
    .from("chat_message")
    .select("message_id, sender_user_id, created_at, unsent_at")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error("MESSAGE_NOT_FOUND");
  if (message.sender_user_id !== user.user_id) throw new Error("NOT_MESSAGE_SENDER");
  if (message.unsent_at) return;
  if (!canUnsendMessage(message.created_at)) {
    throw new Error("UNSEND_WINDOW_EXPIRED");
  }

  const { error: updateError } = await supabase
    .from("chat_message")
    .update({ body: null, unsent_at: new Date().toISOString() })
    .eq("message_id", messageId);
  if (updateError) throw updateError;
}

export async function hideConversationForMe(conversationId: string): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { error } = await supabase
    .from("chat_participant")
    .update({ hidden_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);
  if (error) throw error;
}

export async function setMuted(conversationId: string, muted: boolean): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { error } = await supabase
    .from("chat_participant")
    .update({ muted_at: muted ? new Date().toISOString() : null })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);
  if (error) throw error;
}

export async function setPinned(conversationId: string, pinned: boolean): Promise<void> {
  const user = await requireMessengerUser();
  const supabase = await createClient();
  await requireParticipant(supabase, conversationId, user.user_id);

  const { error } = await supabase
    .from("chat_participant")
    .update({ pinned_at: pinned ? new Date().toISOString() : null })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.user_id);
  if (error) throw error;
}

export type MessageSearchHit = {
  message_id: string;
  conversation_id: string;
  body: string | null;
  created_at: string;
  conversation_display_name: string;
};

export async function searchMessages(query: string): Promise<MessageSearchHit[]> {
  const user = await requireMessengerUser();
  const term = query.trim().replace(/[%_]/g, "");
  if (!term) return [];

  const supabase = await createClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("chat_participant")
    .select("conversation_id")
    .eq("user_id", user.user_id)
    .is("left_at", null)
    .is("hidden_at", null);
  if (membershipError) throw membershipError;

  const conversationIds = (memberships ?? []).map((m) => m.conversation_id);
  if (conversationIds.length === 0) return [];

  const { data: conversations } = await supabase
    .from("chat_conversation")
    .select("conversation_id, type, title")
    .in("conversation_id", conversationIds);
  const participantsByConv = await loadParticipants(supabase, conversationIds);
  const nameById = new Map(
    (conversations ?? []).map((c) => [
      c.conversation_id,
      displayNameFor(c, participantsByConv.get(c.conversation_id) ?? [], user.user_id),
    ])
  );

  const { data, error } = await supabase
    .from("chat_message")
    .select("message_id, conversation_id, body, created_at, unsent_at")
    .in("conversation_id", conversationIds)
    .is("unsent_at", null)
    .ilike("body", `%${term}%`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  return (data ?? []).map((row) => ({
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    body: row.body,
    created_at: row.created_at,
    conversation_display_name: nameById.get(row.conversation_id) ?? "Conversation",
  }));
}
