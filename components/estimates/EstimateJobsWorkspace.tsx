"use client";

import { useActionState, useMemo, useState } from "react";
import type { Recommendation } from "@/lib/services/recommendations";
import type { EstimateVersionView } from "@/lib/services/estimates";
import type { EstimateFormState } from "@/app/(app)/work_orders/estimate-actions";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import { StageChip } from "@/components/ui/StageChip";
import { FormError, SELECT_CLASS } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { EstimateJobEditor } from "@/components/estimates/EstimateJobEditor";
import { EstimateTotals } from "@/components/estimates/EstimateTotals";
import {
  EstimateVersionHistory,
  type EstimateVersionHistoryEntry,
} from "@/components/estimates/EstimateVersionHistory";
import { RecommendationInbox } from "@/components/estimates/RecommendationInbox";
import {
  amendmentNotice,
  blockerMessage,
  buildJobDraft,
  computeWorkspaceTotals,
  decisionsComplete,
  estimableJobs,
  estimateStatusChip,
  formatCents,
  priceDraft,
  rollupPartsForJob,
  seedPricingState,
  toDecisionList,
  workspacePresentationBlockers,
  type DecisionMap,
  type JobPricingFormState,
  type StaffDecision,
  type WorkspaceJob,
  type WorkspacePart,
} from "@/components/estimates/workspaceModel";

type EstimateAction = (
  state: EstimateFormState,
  formData: FormData
) => Promise<EstimateFormState>;

type EstimateActionFor = (
  recommendationId: string,
  state: EstimateFormState,
  formData: FormData
) => Promise<EstimateFormState>;

type RecommendationActionFor = (
  recommendationId: string,
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

const METHOD_OPTIONS = [
  { value: "in_person", label: "In person" },
  { value: "phone", label: "Phone" },
] as const;

/**
 * Estimate & Jobs workspace (Workflow V2): open findings inbox, per-job
 * pricing, live totals, presentation, staff-recorded customer decisions, and
 * the immutable version history. Pricing edits stay client-side until
 * "Present to customer" freezes them into an estimate version.
 */
export function EstimateJobsWorkspace({
  jobs,
  parts,
  openRecommendations,
  liveEstimate,
  versionHistory,
  readOnly,
  writesEnabled,
  canPresent,
  canConfirm,
  presentAction,
  confirmAction,
  addToEstimateActionFor,
  recommendationStatusActionFor,
}: {
  jobs: WorkspaceJob[];
  parts: WorkspacePart[];
  openRecommendations: Recommendation[];
  liveEstimate: EstimateVersionView | null;
  versionHistory: EstimateVersionHistoryEntry[];
  readOnly: boolean;
  writesEnabled: boolean;
  canPresent: boolean;
  canConfirm: boolean;
  presentAction: EstimateAction;
  confirmAction: EstimateAction;
  addToEstimateActionFor: EstimateActionFor;
  recommendationStatusActionFor: RecommendationActionFor;
}) {
  const [pricingState, setPricingState] = useState<Record<string, JobPricingFormState>>(
    {}
  );
  const [dirty, setDirty] = useState(false);
  const [decisions, setDecisions] = useState<DecisionMap>({});

  // A successful presentation freezes the edits into the live version, so the
  // amendment notice resets until the user edits again (state adjusted during
  // render, per React's derived-state guidance).
  const liveHash = liveEstimate?.content_hash ?? null;
  const [seenLiveHash, setSeenLiveHash] = useState(liveHash);
  if (liveHash !== seenLiveHash) {
    setSeenLiveHash(liveHash);
    setDirty(false);
  }

  const [presentState, presentFormAction] = useActionState(presentAction, {
    error: null,
  });
  const [confirmState, confirmFormAction] = useActionState(confirmAction, {
    error: null,
  });

  const actionsDisabled = readOnly || !writesEnabled;
  const workspaceJobs = estimableJobs(jobs);

  const decisionByJob = useMemo(
    () => new Map((liveEstimate?.jobs ?? []).map((job) => [job.job_id, job.decision])),
    [liveEstimate]
  );
  const presentedJobIds = useMemo(
    () => new Set((liveEstimate?.jobs ?? []).map((job) => job.job_id)),
    [liveEstimate]
  );

  const rows = workspaceJobs.map((job) => {
    const state = pricingState[job.job_id] ?? seedPricingState(job);
    const rollup = rollupPartsForJob(parts, job.job_id);
    const draft = buildJobDraft(job, rollup, state);
    return { job, state, rollup, draft, breakdown: priceDraft(draft) };
  });

  const drafts = rows.map((row) => row.draft);
  const totals = computeWorkspaceTotals(drafts);
  const blockers = workspacePresentationBlockers(drafts, totals);
  const notice = amendmentNotice(liveEstimate, dirty);

  const liveIsPresented = liveEstimate?.status === "presented";
  const liveIsConfirmed =
    Boolean(liveEstimate?.confirmed) || liveEstimate?.status === "confirmed";
  const liveJobIds = (liveEstimate?.jobs ?? []).map((job) => job.job_id);
  const confirmReady = decisionsComplete(liveJobIds, decisions);

  function updateJobPricing(jobId: string, next: JobPricingFormState) {
    setPricingState((current) => ({ ...current, [jobId]: next }));
    setDirty(true);
  }

  function setDecision(jobId: string, decision: StaffDecision) {
    setDecisions((current) => ({ ...current, [jobId]: decision }));
  }

  return (
    <div className="flex flex-col gap-4">
      {!writesEnabled ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Workflow V2 writes are disabled in this environment — the workspace is read-only
          for QA.
        </p>
      ) : null}

      <RecommendationInbox
        recommendations={openRecommendations}
        addActionFor={addToEstimateActionFor}
        statusActionFor={recommendationStatusActionFor}
        canAdd={canPresent && !actionsDisabled}
        canUpdateStatus={canConfirm && !readOnly}
      />

      <section aria-label="Estimate jobs" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            Jobs on this estimate
          </h3>
          {liveEstimate ? (
            <div className="flex items-center gap-2 text-sm text-[var(--status-neutral)]">
              <span>Live: version {liveEstimate.version_no}</span>
              <StageChip
                label={estimateStatusChip(liveEstimate.status).label}
                tone={estimateStatusChip(liveEstimate.status).tone}
              />
              <span className="font-semibold text-[var(--foreground)]">
                {formatCents(liveEstimate.total_cents)}
              </span>
            </div>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
            No jobs yet — add findings from the inbox above or a job from the legacy
            controls below.
          </p>
        ) : (
          rows.map((row) => (
            <EstimateJobEditor
              key={row.job.job_id}
              job={row.job}
              partsRollup={row.rollup}
              state={row.state}
              breakdown={row.breakdown}
              liveDecision={decisionByJob.get(row.job.job_id) ?? null}
              onPresentedVersion={presentedJobIds.has(row.job.job_id)}
              disabled={actionsDisabled}
              onChange={(next) => updateJobPricing(row.job.job_id, next)}
            />
          ))
        )}
      </section>

      <EstimateTotals totals={totals} />

      <section aria-label="Present estimate" className="card card-body">
        <h3 className="text-base font-semibold text-[var(--foreground)]">
          Present to customer
        </h3>
        {notice ? (
          <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
            {notice}
          </p>
        ) : null}
        {blockers.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {blockers.map((code) => (
              <li key={code} className="text-sm font-medium text-amber-800">
                {blockerMessage(code)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Presenting freezes prices into an immutable version the customer decides on.
          </p>
        )}
        <form
          action={presentFormAction}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="drafts" value={JSON.stringify(drafts)} />
          <SubmitButton
            label={
              liveIsPresented || liveIsConfirmed
                ? `Present amendment (version ${(liveEstimate?.version_no ?? 0) + 1})`
                : "Present to customer"
            }
            pendingLabel="Presenting…"
            disabled={actionsDisabled || !canPresent || blockers.length > 0}
          />
          <FormError message={presentState.error} />
        </form>
      </section>

      {liveEstimate && liveIsPresented && canConfirm ? (
        <section aria-label="Record customer decisions" className="card card-body">
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            Record customer decisions
          </h3>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Version {liveEstimate.version_no} — every job needs a decision before
            confirming.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {liveEstimate.jobs.map((job) => (
              <li
                key={job.job_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">
                    {job.title_snapshot}
                  </p>
                  <p className="text-xs text-[var(--status-neutral)]">
                    {formatCents(job.total_cents)} incl. HST
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {(["approved", "declined"] as StaffDecision[]).map((decision) => (
                    <label
                      key={decision}
                      className="flex items-center gap-1.5 text-sm text-[var(--foreground)]"
                    >
                      <input
                        type="radio"
                        name={`decision-${job.job_id}`}
                        className="h-4 w-4"
                        checked={decisions[job.job_id] === decision}
                        disabled={actionsDisabled}
                        onChange={() => setDecision(job.job_id, decision)}
                      />
                      {decision === "approved" ? "Approve" : "Decline"}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <form
            action={confirmFormAction}
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            <input
              type="hidden"
              name="estimate_version_id"
              value={liveEstimate.estimate_version_id}
            />
            <input
              type="hidden"
              name="expected_content_hash"
              value={liveEstimate.content_hash ?? ""}
            />
            <input
              type="hidden"
              name="decisions"
              value={JSON.stringify(toDecisionList(liveJobIds, decisions))}
            />
            <label className="min-w-[10rem]">
              <span className="field-label">Method</span>
              <select className={SELECT_CLASS} name="method" defaultValue="in_person">
                {METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton
              label="Confirm decisions"
              pendingLabel="Confirming…"
              disabled={actionsDisabled || !confirmReady}
            />
            <FormError message={confirmState.error} />
          </form>
          {!confirmReady ? (
            <p className="mt-2 text-xs text-[var(--status-neutral)]">
              Choose approve or decline for every job to enable confirmation.
            </p>
          ) : null}
        </section>
      ) : null}

      {liveEstimate && liveIsConfirmed ? (
        <section aria-label="Confirmed decisions" className="card card-body">
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            Customer decisions on version {liveEstimate.version_no}
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {liveEstimate.jobs.map((job) => (
              <li key={job.job_id} className="flex items-center justify-between text-sm">
                <span className="text-[var(--foreground)]">{job.title_snapshot}</span>
                <StageChip
                  label={
                    job.decision === "approved"
                      ? "Approved"
                      : job.decision === "declined"
                        ? "Declined"
                        : job.decision === "deferred"
                          ? "Deferred"
                          : "Pending"
                  }
                  tone={
                    job.decision === "approved"
                      ? "teal"
                      : job.decision === "declined"
                        ? "danger"
                        : "muted"
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <EstimateVersionHistory versions={versionHistory} />
    </div>
  );
}
