"use server";

import { revalidatePath } from "next/cache";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  addGroupMembers,
  createGroup,
  editMessage,
  hideConversationForMe,
  markConversationRead,
  removeGroupMember,
  searchMessages,
  sendTextMessage,
  setMuted,
  setPinned,
  startDirectMessage,
  toggleReaction,
  unsendMessage,
} from "@/lib/services/messenger";
import { uploadChatImage, uploadVoiceNote } from "@/lib/services/messengerAttachments";
import {
  acceptCall,
  declineCall,
  endCall,
  startCall,
} from "@/lib/services/messengerCalls";

function revalidateConversation(conversationId: string) {
  revalidatePath("/messages");
  revalidatePath(`/messages/${conversationId}`);
}

export async function startDirectMessageAction(
  otherUserId: string
): Promise<{ error: string | null; conversationId?: string }> {
  try {
    const conversation = await startDirectMessage(otherUserId);
    revalidatePath("/messages");
    return { error: null, conversationId: conversation.conversation_id };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function createGroupAction(
  title: string,
  memberUserIds: string[]
): Promise<{ error: string | null; conversationId?: string }> {
  try {
    const conversation = await createGroup({ title, memberUserIds });
    revalidatePath("/messages");
    return { error: null, conversationId: conversation.conversation_id };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
  replyToMessageId?: string | null
): Promise<{ error: string | null }> {
  try {
    await sendTextMessage(conversationId, body, replyToMessageId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function markReadAction(
  conversationId: string
): Promise<{ error: string | null }> {
  try {
    await markConversationRead(conversationId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function toggleReactionAction(
  conversationId: string,
  messageId: string,
  emoji: string
): Promise<{ error: string | null }> {
  try {
    await toggleReaction(messageId, emoji);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function editMessageAction(
  conversationId: string,
  messageId: string,
  body: string
): Promise<{ error: string | null }> {
  try {
    await editMessage(messageId, body);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function unsendMessageAction(
  conversationId: string,
  messageId: string
): Promise<{ error: string | null }> {
  try {
    await unsendMessage(messageId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function hideConversationAction(
  conversationId: string
): Promise<{ error: string | null }> {
  try {
    await hideConversationForMe(conversationId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/messages");
  return { error: null };
}

export async function setMutedAction(
  conversationId: string,
  muted: boolean
): Promise<{ error: string | null }> {
  try {
    await setMuted(conversationId, muted);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function setPinnedAction(
  conversationId: string,
  pinned: boolean
): Promise<{ error: string | null }> {
  try {
    await setPinned(conversationId, pinned);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function searchMessagesAction(
  query: string
): Promise<{ error: string | null; hits?: Awaited<ReturnType<typeof searchMessages>> }> {
  try {
    const hits = await searchMessages(query);
    return { error: null, hits };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function uploadChatImageAction(
  conversationId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("ATTACHMENT_TYPE_INVALID");
    await uploadChatImage(conversationId, file);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function uploadVoiceNoteAction(
  conversationId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  try {
    const file = formData.get("file");
    const durationRaw = formData.get("duration_ms");
    if (!(file instanceof File)) throw new Error("ATTACHMENT_TYPE_INVALID");
    const durationMs = typeof durationRaw === "string" ? Number(durationRaw) : 0;
    await uploadVoiceNote(conversationId, file, durationMs || 0);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function addGroupMembersAction(
  conversationId: string,
  memberUserIds: string[]
): Promise<{ error: string | null }> {
  try {
    await addGroupMembers(conversationId, memberUserIds);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function removeGroupMemberAction(
  conversationId: string,
  memberUserId: string
): Promise<{ error: string | null }> {
  try {
    await removeGroupMember(conversationId, memberUserId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidateConversation(conversationId);
  return { error: null };
}

export async function startCallAction(
  conversationId: string,
  kind: "audio" | "video"
): Promise<{ error: string | null; callId?: string }> {
  try {
    const call = await startCall(conversationId, kind);
    revalidateConversation(conversationId);
    return { error: null, callId: call.call_id };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function acceptCallAction(
  callId: string
): Promise<{ error: string | null }> {
  try {
    await acceptCall(callId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  return { error: null };
}

export async function declineCallAction(
  callId: string
): Promise<{ error: string | null }> {
  try {
    await declineCall(callId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  return { error: null };
}

export async function endCallAction(callId: string): Promise<{ error: string | null }> {
  try {
    await endCall(callId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  return { error: null };
}
