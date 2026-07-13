import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canUseMessenger } from "@/lib/permissions";
import { listConversations } from "@/lib/services/messenger";
import { MessagesClient } from "@/components/messages/MessagesClient";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canUseMessenger(user.role)) redirect("/dashboard");

  const conversations = await listConversations();

  return <MessagesClient conversations={conversations} currentUserId={user.user_id} />;
}
