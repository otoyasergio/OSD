import { redirect, notFound } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canUseMessenger } from "@/lib/permissions";
import {
  getConversation,
  listConversations,
  listMessages,
} from "@/lib/services/messenger";
import { signChatAttachmentPaths } from "@/lib/services/messengerAttachments";
import { MessagesClient } from "@/components/messages/MessagesClient";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ conversation_id: string }>;
};

export default async function ConversationPage({ params }: Props) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canUseMessenger(user.role)) redirect("/dashboard");

  const { conversation_id } = await params;

  let conversation;
  try {
    conversation = await getConversation(conversation_id);
  } catch {
    notFound();
  }

  const [conversations, messages] = await Promise.all([
    listConversations(),
    listMessages(conversation_id),
  ]);

  const paths = messages.flatMap((m) => m.attachments.map((a) => a.storage_path));
  const signed = await signChatAttachmentPaths(paths, conversation_id);
  const messagesWithUrls = messages.map((m) => ({
    ...m,
    attachments: m.attachments.map((a) => ({
      ...a,
      signed_url: signed.get(a.storage_path) ?? null,
    })),
  }));

  return (
    <MessagesClient
      conversations={conversations}
      currentUserId={user.user_id}
      activeConversationId={conversation_id}
      conversation={conversation}
      messages={messagesWithUrls}
    />
  );
}
