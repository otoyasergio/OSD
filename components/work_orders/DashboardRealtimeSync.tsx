"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/database/supabase-browser";
import { useDebouncedRouterRefresh } from "@/lib/client/useDebouncedRouterRefresh";

export function DashboardRealtimeSync({ locationId }: { locationId: string }) {
  const router = useRouter();
  const { schedule: scheduleRefresh } = useDebouncedRouterRefresh({ delayMs: 800 });

  useEffect(() => {
    // Bust any prefetched Client Router Cache snapshot when landing on Dashboard.
    router.refresh();
  }, [router]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`dashboard:${locationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_order",
          filter: `location_id=eq.${locationId}`,
        },
        () => {
          scheduleRefresh();
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "job" }, () => {
        scheduleRefresh();
      })
      .subscribe();

    function handleFocusOrVisible() {
      if (document.visibilityState === "hidden") return;
      scheduleRefresh();
    }

    window.addEventListener("focus", handleFocusOrVisible);
    document.addEventListener("visibilitychange", handleFocusOrVisible);

    return () => {
      window.removeEventListener("focus", handleFocusOrVisible);
      document.removeEventListener("visibilitychange", handleFocusOrVisible);
      void supabase.removeChannel(channel);
    };
  }, [locationId, scheduleRefresh]);

  return null;
}
