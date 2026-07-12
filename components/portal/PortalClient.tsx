"use client";

import { useState, useTransition } from "react";
import type { AgreementTemplate } from "@/lib/services/contracts";
import type { PortalWorkOrderView } from "@/lib/services/portal";
import { ContractSigningPanel } from "@/components/contracts/ContractSigningPanel";
import {
  portalAckInspectionAction,
  portalApproveJobAction,
  portalDeclineJobAction,
  portalSignContractAction,
} from "@/app/c/[token]/actions";
import { FormError } from "@/components/forms/Field";

type Props = {
  token: string;
  view: PortalWorkOrderView;
  contractTemplate: AgreementTemplate | null;
};

export function PortalClient({ token, view, contractTemplate }: Props) {
  const [declineJobId, setDeclineJobId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [ackName, setAckName] = useState(
    `${view.customer.first_name} ${view.customer.last_name}`.trim()
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pendingJobs = view.jobs.filter((j) => j.status === "waiting_for_approval");
  const estimateTotal = [...view.jobs, ...view.parts.map((p) => p)].reduce(
    (sum, item) => {
      if ("standard_price_snapshot" in item) {
        return sum + Number(item.standard_price_snapshot ?? 0);
      }
      return sum + Number(item.unit_price ?? 0) * item.quantity;
    },
    0
  );

  return (
    <div className="flex flex-col gap-6">
      {!view.has_signed_contract && contractTemplate ? (
        <section className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Drop-off agreement</h2>
          <ContractSigningPanel
            template={contractTemplate}
            existing={null}
            action={async (formData) =>
              portalSignContractAction(token, formData)
            }
          />
        </section>
      ) : null}

      {pendingJobs.length > 0 ? (
        <section className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Approve recommended work</h2>
          <ul className="flex flex-col gap-4">
            {pendingJobs.map((job) => (
              <li
                key={job.job_id}
                className="flex flex-col gap-2 border-b border-zinc-100 pb-4 last:border-0"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{job.name_snapshot}</span>
                  {job.standard_price_snapshot != null ? (
                    <span>${Number(job.standard_price_snapshot).toFixed(2)}</span>
                  ) : null}
                </div>
                {declineJobId === job.job_id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      className="min-h-20 w-full rounded border border-zinc-300 p-2"
                      placeholder="Reason for declining (optional)"
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            const r = await portalDeclineJobAction(
                              token,
                              job.job_id,
                              declineReason
                            );
                            setError(r.error);
                            setDeclineJobId(null);
                          })
                        }
                      >
                        Confirm decline
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setDeclineJobId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const r = await portalApproveJobAction(token, job.job_id);
                          setError(r.error);
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => setDeclineJobId(job.job_id)}
                    >
                      Decline
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Estimate summary</h2>
        <ul className="mb-4 divide-y divide-zinc-100 text-sm">
          {view.jobs.map((job) => (
            <li key={job.job_id} className="flex justify-between py-2">
              <span>{job.name_snapshot}</span>
              <span>
                {job.standard_price_snapshot != null
                  ? `$${Number(job.standard_price_snapshot).toFixed(2)}`
                  : "—"}
              </span>
            </li>
          ))}
          {view.parts.map((part, i) => (
            <li key={`${part.part_name}-${i}`} className="flex justify-between py-2">
              <span>
                {part.part_name} × {part.quantity}
              </span>
              <span>
                {part.unit_price != null
                  ? `$${(part.unit_price * part.quantity).toFixed(2)}`
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-right font-semibold">
          Total (est.): ${estimateTotal.toFixed(2)}
        </p>
        {view.square_payment_status === "paid" &&
        view.billing_stage === "paid" ? (
          <p className="mt-3 text-center font-medium text-emerald-700">
            Paid — thank you!
          </p>
        ) : view.billing_stage === "invoiced" &&
          view.square_invoice_public_url ? (
          <a
            href={view.square_invoice_public_url}
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary mt-4 w-full text-center"
          >
            Pay now
          </a>
        ) : (
          <p className="mt-3 text-center text-sm text-zinc-600">
            {view.billing_stage === "awaiting_approval" ||
            pendingJobs.length > 0
              ? "Approve the work above. Payment link will appear when the shop publishes your invoice."
              : "Payment link will be sent when your invoice is ready."}
          </p>
        )}
      </section>

      {view.inspection_completed && !view.has_inspection_ack ? (
        <section className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">Inspection acknowledgement</h2>
          <p className="mb-4 text-sm text-zinc-600">
            By signing below you acknowledge reviewing the inspection findings for this
            visit.
          </p>
          <label className="mb-3 block">
            <span className="field-label">Your name</span>
            <input
              type="text"
              className="min-h-11 w-full rounded border border-zinc-300 px-3"
              value={ackName}
              onChange={(e) => setAckName(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !ackName.trim()}
            onClick={() =>
              startTransition(async () => {
                const r = await portalAckInspectionAction(token, ackName.trim());
                setError(r.error);
              })
            }
          >
            Acknowledge inspection
          </button>
        </section>
      ) : view.has_inspection_ack ? (
        <p className="text-center text-sm text-emerald-700">Inspection acknowledged.</p>
      ) : null}

      {error ? <FormError message={error} /> : null}
    </div>
  );
}
