"use server";

import { toFormErrorMessage } from "@/lib/services/errors";
import { listConversations } from "@/lib/services/messenger";
import {
  clearVoicePresence,
  heartbeatVoicePresence,
  listOnlineStaffIds,
  listPhoneCalls,
  prepareOutboundPstnCall,
  prepareOutboundStaffCall,
  type PhoneCall,
} from "@/lib/services/shopPhone";

export async function heartbeatVoicePresenceAction(): Promise<{ error: string | null }> {
  try {
    await heartbeatVoicePresence();
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function clearVoicePresenceAction(): Promise<{ error: string | null }> {
  try {
    await clearVoicePresence();
    return { error: null };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function preparePstnCallAction(input: {
  to?: string | null;
  customerId?: string | null;
  workOrderId?: string | null;
}): Promise<{
  error: string | null;
  phoneCallId?: string;
  to?: string;
  customerName?: string | null;
}> {
  try {
    const result = await prepareOutboundPstnCall(input);
    return { error: null, ...result };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function prepareStaffCallAction(conversationId: string): Promise<{
  error: string | null;
  phoneCallId?: string;
  toUserIds?: string[];
  displayName?: string;
}> {
  try {
    const result = await prepareOutboundStaffCall({ conversationId });
    return { error: null, ...result };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function listPhoneCallsAction(): Promise<{
  error: string | null;
  calls?: PhoneCall[];
}> {
  try {
    const calls = await listPhoneCalls();
    return { error: null, calls };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}

export async function loadCommsSnapshotAction(): Promise<{
  error: string | null;
  unreadCount?: number;
  recents?: Array<{
    conversation_id: string;
    display_name: string;
    last_message_preview: string | null;
    unread: boolean;
  }>;
  onlineUserIds?: string[];
}> {
  try {
    const [conversations, onlineUserIds] = await Promise.all([
      listConversations(),
      listOnlineStaffIds(),
    ]);
    return {
      error: null,
      unreadCount: conversations.filter((c) => c.unread).length,
      recents: conversations.slice(0, 8).map((c) => ({
        conversation_id: c.conversation_id,
        display_name: c.display_name,
        last_message_preview: c.last_message_preview,
        unread: c.unread,
      })),
      onlineUserIds,
    };
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
}
