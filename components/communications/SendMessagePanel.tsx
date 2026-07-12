"use client";

import { useState, useTransition } from "react";
import { sendMessageAction } from "@/app/(app)/work_orders/communication-actions";
import type { CommunicationLogEntry } from "@/lib/services/communications";
import { FormError } from "@/components/forms/Field";

const TEMPLATES = [
  { key: "approval_request", label: "Approval request" },
  { key: "ready_for_pickup", label: "Ready for pickup" },
  { key: "contract_link", label: "Contract link" },
  { key: "payment_reminder", label: "Payment reminder" },
] as const;

type Props = {
  workOrderId: string;
  logs: CommunicationLogEntry[];
  canSend: boolean;
  readOnly?: boolean;
};

export function SendMessagePanel({
  workOrderId,
  logs,
  canSend,
  readOnly = false,
}: Props) {
  const [templateKey, setTemplateKey] =
    useState<(typeof TEMPLATES)[number]["key"]>("approval_request");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await sendMessageAction(workOrderId, templateKey, channel);
      setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canSend && !readOnly ? (
        <div className="card card-pad flex flex-col gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
            Send customer message
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">Template</span>
              <select
                className="min-h-11 w-full rounded border border-zinc-300 px-3"
                value={templateKey}
                onChange={(e) =>
                  setTemplateKey(e.target.value as (typeof TEMPLATES)[number]["key"])
                }
              >
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="field-label">Channel</span>
              <select
                className="min-h-11 w-full rounded border border-zinc-300 px-3"
                value={channel}
                onChange={(e) => setChannel(e.target.value as "sms" | "email")}
              >
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn btn-primary self-start"
            disabled={pending}
            onClick={send}
          >
            {pending ? "Sending…" : "Send"}
          </button>
          {error ? <FormError message={error} /> : null}
        </div>
      ) : null}

      {logs.length > 0 ? (
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white text-sm">
          {logs.map((log) => (
            <li key={log.log_id} className="px-4 py-3">
              <p className="font-medium capitalize text-zinc-900">
                {log.direction} {log.channel} · {log.status}
                {log.template_key ? ` · ${log.template_key}` : ""}
              </p>
              <p className="text-xs text-zinc-500">
                {new Date(log.created_at).toLocaleString()} → {log.to_address}
              </p>
              <p className="mt-1 line-clamp-2 text-zinc-600">{log.body.replace(/<[^>]+>/g, " ")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No messages logged yet.</p>
      )}
    </div>
  );
}
