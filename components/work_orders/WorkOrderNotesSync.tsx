"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/database/supabase-browser";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";
import { registerTechnicianNoteRealtime } from "@/lib/notes/realtime";

/** Refresh an open work order when the floor adds or changes a note. */
export function WorkOrderNotesSync({ workOrderId }: { workOrderId: string }) {
  const { schedule } = useDebouncedRouterRefresh({ delayMs: 800 });

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`work-order-notes:${workOrderId}`);
    registerTechnicianNoteRealtime(channel, [workOrderId], () => {
      schedule();
    });
    channel.subscribe();

    function handleFocusOrVisible() {
      if (document.visibilityState === "hidden") return;
      schedule();
    }

    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);

    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
      void supabase.removeChannel(channel);
    };
  }, [schedule, workOrderId]);

  return null;
}
