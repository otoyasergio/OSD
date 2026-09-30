import { createHash } from "node:crypto";
import type { AuthorizationDecision } from "@/lib/database/types";

/**
 * Pure decision/confirmation rules for a presented estimate version.
 * The database RPC enforces the same rules transactionally; this module is
 * the tested specification and the client-side pre-validation.
 */

export type DecisionInput = {
  jobId: string;
  decision: AuthorizationDecision;
};

export type ConfirmationValidationInput = {
  /** Every job frozen on the presented version. */
  presentedJobIds: string[];
  decisions: DecisionInput[];
  /** Hash the client saw when the estimate was rendered. */
  expectedContentHash: string;
  /** Hash currently stored on the presented version. */
  actualContentHash: string;
  versionStatus: "draft" | "presented" | "confirmed" | "superseded" | "void";
};

export type ConfirmationValidation =
  { ok: true; decisionsHash: string } | { ok: false; errors: string[] };

export function computeDecisionsHash(decisions: DecisionInput[]): string {
  const sorted = [...decisions].sort((a, b) => a.jobId.localeCompare(b.jobId));
  return createHash("sha256")
    .update(JSON.stringify(sorted.map((d) => [d.jobId, d.decision])))
    .digest("hex");
}

export function validateConfirmation(
  input: ConfirmationValidationInput
): ConfirmationValidation {
  const errors: string[] = [];

  if (input.versionStatus === "confirmed") {
    errors.push("ESTIMATE_ALREADY_CONFIRMED");
  } else if (input.versionStatus !== "presented") {
    errors.push("ESTIMATE_NOT_PRESENTED");
  }

  if (input.expectedContentHash !== input.actualContentHash) {
    errors.push("ESTIMATE_CONTENT_STALE");
  }

  const presented = new Set(input.presentedJobIds);
  const seen = new Set<string>();
  for (const decision of input.decisions) {
    if (!presented.has(decision.jobId)) {
      errors.push("DECISION_FOR_UNKNOWN_JOB");
      continue;
    }
    if (seen.has(decision.jobId)) {
      errors.push("DUPLICATE_DECISION");
      continue;
    }
    seen.add(decision.jobId);
  }
  for (const jobId of presented) {
    if (!seen.has(jobId)) {
      errors.push("DECISION_MISSING");
      break;
    }
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, decisionsHash: computeDecisionsHash(input.decisions) };
}

/**
 * Replay safety: a repeat submission with the same decisions hash against an
 * already-confirmed version is an idempotent success, not an error.
 */
export function isIdempotentReplay(args: {
  versionStatus: string;
  existingDecisionsHash: string | null;
  submittedDecisions: DecisionInput[];
}): boolean {
  return (
    args.versionStatus === "confirmed" &&
    args.existingDecisionsHash !== null &&
    args.existingDecisionsHash === computeDecisionsHash(args.submittedDecisions)
  );
}
