"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  dismissClientActionAction,
  sendClientActionAction,
} from "@/app/(app)/actions/actions";
import { FormError } from "@/components/forms/Field";
import { RecoverableSignedImage } from "@/components/photos/RecoverableSignedImage";
import type { ClientActionListItem } from "@/lib/services/clientActions";

const BLOCK_COPY = {
  phone: "No mobile number that can receive a text.",
  opt_out: "This customer opted out of SMS.",
} as const;

export function ClientActionCard({ item }: { item: ClientActionListItem }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const href = item.workOrderId
    ? `/work_orders/${item.workOrderId}`
    : `/customers/${item.customerId}`;
  const linkLabel = item.workOrderNumber
    ? `Work order ${item.workOrderNumber}`
    : "Customer";

  function run(kind: "send" | "dismiss") {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "send"
          ? await sendClientActionAction({
              reason: item.reason,
              cycleKey: item.cycleKey,
              body,
            })
          : await dismissClientActionAction({
              reason: item.reason,
              cycleKey: item.cycleKey,
            });
      setError(result.error);
    });
  }

  return (
    <article className="card card-pad space-y-3">
      <div className="flex gap-3">
        {item.photoUrl ? (
          <RecoverableSignedImage
            src={item.photoUrl}
            alt={item.bikeLabel ?? "Motorcycle"}
            className="h-16 w-24 shrink-0 rounded-md bg-[var(--surface-muted)] object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold text-foreground">{item.title}</h2>
            <Link href={href} className="text-sm font-medium text-foreground underline">
              {linkLabel}
            </Link>
          </div>
          <p className="text-sm text-foreground">
            {item.customerName}
            {item.bikeLabel ? ` · ${item.bikeLabel}` : ""}
          </p>
          <p className="text-sm text-[var(--status-neutral)]">{item.detail}</p>
        </div>
      </div>
      {item.smsBlock ? (
        <p className="text-sm text-[var(--status-neutral)]">
          {BLOCK_COPY[item.smsBlock]}
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm text-[var(--status-neutral)]">Text message</span>
            <textarea
              className="textarea min-h-24 w-full"
              value={body}
              maxLength={900}
              disabled={pending}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || body.trim() === ""}
              onClick={() => run("send")}
            >
              Send text
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => run("dismiss")}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {!item.smsBlock ? null : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => run("dismiss")}
        >
          Not now
        </button>
      )}
      <FormError message={error} />
    </article>
  );
}
