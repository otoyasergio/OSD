"use client";

import type { AppUser } from "@/lib/auth/session";
import { canUseMessenger } from "@/lib/permissions/checks";
import { ShopVoiceProvider } from "@/components/comms/ShopVoiceProvider";
import { CallOverlay } from "@/components/messages/CallOverlay";
import { CommsSnapshotProvider } from "@/components/comms/CommsDock";

export function CommsLayer({
  user,
  children,
}: {
  user: AppUser;
  children: React.ReactNode;
}) {
  if (!canUseMessenger(user.role)) return children;

  return (
    <CommsSnapshotProvider userId={user.user_id}>
      <ShopVoiceProvider user={user}>
        {children}
        <CallOverlay currentUserId={user.user_id} />
      </ShopVoiceProvider>
    </CommsSnapshotProvider>
  );
}
