"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listPhoneCallsAction } from "@/app/(app)/messages/voice-actions";
import type { PhoneCall } from "@/lib/services/shopPhone";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hrefFor(call: PhoneCall): string | null {
  if (call.work_order_id) return `/work_orders/${call.work_order_id}`;
  if (call.customer_id) return `/customers/${call.customer_id}`;
  if (call.conversation_id) return `/messages/${call.conversation_id}`;
  return null;
}

export function CallsPane() {
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPhoneCallsAction().then((result) => {
      if (result.error) {
        setError(result.error);
        return;
      }
      setCalls(result.calls ?? []);
    });
  }, []);

  if (error) {
    return <p className="p-6 text-sm text-[var(--status-danger-fg)]">{error}</p>;
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
        No shop or staff calls at this location yet.
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto">
      {calls.map((call) => {
        const href = hrefFor(call);
        const label = `${call.direction === "inbound" ? "Incoming" : "Outgoing"} ${
          call.channel === "pstn" ? "customer" : "staff"
        } · ${call.counterparty_label}`;
        const inner = (
          <>
            <span className="block font-medium">{label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {call.status.replace("_", " ")} · {formatWhen(call.started_at)}
            </span>
          </>
        );
        return (
          <li key={call.phone_call_id} className="border-b border-[var(--border)]">
            {href ? (
              <Link
                href={href}
                className="block px-4 py-3 hover:bg-[var(--surface-muted)]"
              >
                {inner}
              </Link>
            ) : (
              <div className="px-4 py-3">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
