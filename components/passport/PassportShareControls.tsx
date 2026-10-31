"use client";

import { useActionState, useState } from "react";
import type { PassportActionState } from "@/app/(app)/motorcycles/[motorcycle_id]/passport/actions";
import { FormError } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { passportShareStatus, type PassportShareStatus } from "@/lib/passport/tokens";
import type { PassportShareSummary } from "@/lib/services/passportShare";

const INITIAL_STATE: PassportActionState = {
  error: null,
  message: null,
  shareUrl: null,
  shareExpiresAt: null,
};

type Action = (
  state: PassportActionState,
  formData: FormData
) => Promise<PassportActionState>;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  }).format(new Date(value));
}

function statusClasses(status: PassportShareStatus): string {
  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "expired") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  return "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--status-neutral)]";
}

function RevokeShareForm({ shareId, action }: { shareId: string; action: Action }) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="share_id" value={shareId} />
      <FormError message={state.error} />
      {state.message ? (
        <p role="status" className="mb-2 text-xs text-emerald-800">
          {state.message}
        </p>
      ) : null}
      <SubmitButton label="Revoke link" pendingLabel="Revoking…" variant="danger" />
    </form>
  );
}

export function PassportShareControls({
  createAction,
  revokeAction,
  shares,
}: {
  createAction: Action;
  revokeAction: Action;
  shares: PassportShareSummary[];
}) {
  const [state, formAction] = useActionState(createAction, INITIAL_STATE);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  async function copyLink() {
    if (!state.shareUrl) return;
    await navigator.clipboard.writeText(state.shareUrl);
    setCopiedUrl(state.shareUrl);
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-white p-4">
      <h2 className="text-lg font-semibold">Share current version</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        A new link lasts seven days and revokes any earlier active link for this version.
        The secret is shown only once.
      </p>

      <form action={formAction} className="mt-4">
        <FormError message={state.error} />
        {state.message ? (
          <p
            role="status"
            className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            {state.message}
          </p>
        ) : null}
        <SubmitButton
          label="Create seven-day link"
          pendingLabel="Creating link…"
          variant="accent"
        />
      </form>

      {state.shareUrl ? (
        <div className="mt-4 rounded border border-[var(--border-strong)] p-3">
          <label
            htmlFor="passport-share-url"
            className="text-sm font-medium text-foreground"
          >
            Copy this link now
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="passport-share-url"
              className="input min-w-0 flex-1 font-mono text-xs"
              readOnly
              value={state.shareUrl}
            />
            <button type="button" onClick={copyLink} className="btn btn-secondary">
              {copiedUrl === state.shareUrl ? "Copied" : "Copy"}
            </button>
          </div>
          {state.shareExpiresAt ? (
            <p className="mt-2 text-xs text-[var(--status-neutral)]">
              Expires {formatDateTime(state.shareExpiresAt)}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Recent links</h3>
        {shares.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--status-neutral)]">
            No links have been issued for this version.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shares.map((share) => {
              const status = passportShareStatus(share);
              return (
                <li
                  key={share.share_id}
                  className={`rounded border px-3 py-2 text-sm ${statusClasses(status)}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium capitalize">{status}</p>
                      <p className="mt-0.5 text-xs">
                        Issued {formatDateTime(share.created_at)} · Expires{" "}
                        {formatDateTime(share.expires_at)}
                      </p>
                    </div>
                  </div>
                  {status === "active" ? (
                    <RevokeShareForm shareId={share.share_id} action={revokeAction} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
