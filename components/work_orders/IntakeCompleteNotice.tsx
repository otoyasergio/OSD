"use client";

import { useEffect, useState } from "react";
import type { IntakeFollowUp } from "@/lib/forms/intakeCompletion";

const DISPLAY_TIME_MS = 6000;

type Props = {
  followUp?: IntakeFollowUp;
};

const FOLLOW_UP_MESSAGES: Record<IntakeFollowUp, string> = {
  signature:
    "The intake is saved. The drop-off agreement can be signed later from the work order.",
  paper_copy:
    "The intake is saved. The signed paper copy can be attached later from the work order.",
};

export function IntakeCompleteNotice({ followUp }: Props) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("intake");
    url.searchParams.delete("follow_up");
    window.history.replaceState(window.history.state, "", url);

    const timeout = window.setTimeout(() => setVisible(false), DISPLAY_TIME_MS);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-950"
    >
      <span aria-hidden className="text-lg leading-6">
        ✓
      </span>
      <div className="flex-1">
        <p className="font-semibold">Intake complete</p>
        <p className="text-sm">
          {followUp
            ? FOLLOW_UP_MESSAGES[followUp]
            : "The customer and motorcycle intake has been saved."}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-ghost min-h-9 px-3 text-sm"
        onClick={() => setVisible(false)}
        aria-label="Dismiss intake complete message"
      >
        Dismiss
      </button>
    </div>
  );
}
