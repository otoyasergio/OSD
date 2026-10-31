"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  sendReadyForPickupNoticeAction,
  type PickupNoticeActionResult,
} from "@/app/(app)/work_orders/pickup-notice-actions";
import {
  PICKUP_NOTICE_BLOCKER_COPY,
  pickupNoticeBlockers,
  pickupNoticePromptBody,
  type PickupNoticeContact,
} from "@/lib/communications/pickupNotice";

type Props = {
  contact: PickupNoticeContact;
  locationCode: string;
  onClose: () => void;
};

function channelLine(
  label: string,
  result: PickupNoticeActionResult["sms"]
): string | null {
  if (!result) return null;
  if (result.status === "sent" && !result.detail) return `${label} sent.`;
  if (result.status === "sent") return `${label}: ${result.detail}`;
  if (result.status === "uncertain") {
    return `${label} outcome uncertain. ${result.detail ?? ""}`.trim();
  }
  return `${label} could not be sent. ${result.detail ?? ""}`.trim();
}

export function PickupNoticeDialog({ contact, locationCode, onClose }: Props) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PickupNoticeActionResult | null>(null);
  const blockers = pickupNoticeBlockers({
    phone: contact.phone,
    email: contact.email,
    smsOptedOut: contact.smsOptedOut,
    locationCode,
  });
  const canSend = blockers.length === 0 && !result;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  function send() {
    startTransition(async () => {
      const next = await sendReadyForPickupNoticeAction(contact.workOrderId);
      setResult(next);
    });
  }

  const smsLine = channelLine("Text", result?.sms ?? null);
  const emailLine = channelLine("Email", result?.email ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="pickup-notice-dialog"
        className="card card-pad w-full max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          Notify the customer?
        </h2>
        <p className="mt-2 text-sm text-foreground">
          {pickupNoticePromptBody(contact.customerName)}
        </p>
        <dl className="mt-3 grid gap-1 text-sm text-foreground">
          <div>
            <dt className="inline font-semibold">Text </dt>
            <dd className="inline">{contact.phone?.trim() || "No phone on file"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Email </dt>
            <dd className="inline">{contact.email?.trim() || "No email on file"}</dd>
          </div>
        </dl>
        {blockers.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-foreground">
            {blockers.map((blocker) => (
              <li key={blocker}>{PICKUP_NOTICE_BLOCKER_COPY[blocker]}</li>
            ))}
          </ul>
        ) : null}
        {result?.error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {result.error}
          </p>
        ) : null}
        {smsLine || emailLine ? (
          <div className="mt-3 space-y-1 text-sm text-foreground" role="status">
            {smsLine ? <p>{smsLine}</p> : null}
            {emailLine ? <p>{emailLine}</p> : null}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={closeRef}
            type="button"
            className="btn btn-secondary min-h-11"
            data-testid="pickup-notice-skip"
            disabled={pending}
            onClick={onClose}
          >
            {result ? "Close" : "Don't send"}
          </button>
          {canSend ? (
            <button
              type="button"
              className="btn btn-primary min-h-11"
              data-testid="pickup-notice-send"
              disabled={pending}
              onClick={send}
            >
              {pending ? "Sending…" : "Send SMS & email"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
