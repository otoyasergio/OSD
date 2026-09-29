import { z } from "zod";

export const diagnosticsModes = ["shop", "teach", "intake", "advisor", "report"] as const;

export const diagnosticsPhases = [
  "information_needed",
  "diagnosis",
  "repair_planning",
  "repair_in_progress",
  "verification",
  "ready_for_technician_verification",
  "closure_report",
] as const;

export const diagnosticsConfidenceLevels = ["confirmed", "probable", "possible"] as const;

export const diagnosticsRequestedInputTypes = [
  "question",
  "measurement",
  "technical_data",
  "photo",
  "test_result",
  "none",
] as const;

export type DiagnosticsMode = (typeof diagnosticsModes)[number];
export type DiagnosticsPhase = (typeof diagnosticsPhases)[number];

const evidenceAssessmentSchema = z
  .object({
    conclusion: z.string().min(1).max(500),
    confidence: z.enum(diagnosticsConfidenceLevels),
    evidence: z.array(z.string().min(1).max(500)).min(1).max(8),
    confirming_test: z.string().min(1).max(500).nullable(),
  })
  .strict();

const requestedInputSchema = z
  .object({
    type: z.enum(diagnosticsRequestedInputTypes),
    prompt: z.string().min(1).max(750).nullable(),
    purpose: z.string().min(1).max(500).nullable(),
    tool_placement: z.string().min(1).max(750).nullable(),
    conditions: z.string().min(1).max(750).nullable(),
    units: z.string().min(1).max(120).nullable(),
  })
  .strict();

const safetySchema = z
  .object({
    stop_work: z.boolean(),
    do_not_ride: z.boolean(),
    boundary: z.string().min(1).max(750).nullable(),
  })
  .strict();

const sourceSchema = z
  .object({
    label: z.string().min(1).max(200),
    authority: z.enum([
      "official_oem",
      "regulatory",
      "model_specific",
      "provided_reference",
      "general_workshop_practice",
      "unverified",
    ]),
    status: z.enum([
      "consulted",
      "provided_not_verified",
      "not_supplied",
      "not_accessible",
      "not_checked",
      "not_verified",
    ]),
    citation: z.string().min(1).max(500).nullable(),
    applies_to: z.string().min(1).max(300),
  })
  .strict();

export const diagnosticsShopLogSchema = z
  .object({
    date_time: z.string().min(1).max(100).nullable(),
    bike_or_ro: z.string().min(1).max(200),
    complaint: z.string().min(1).max(750),
    tests_and_conditions: z.string().min(1).max(1_500),
    results_and_units: z.string().min(1).max(1_500),
    conclusions_and_confidence: z.string().min(1).max(1_500),
    repairs_performed: z.string().min(1).max(1_000),
    verification: z.string().min(1).max(1_000),
    authorization: z.string().min(1).max(750),
    open_items: z.string().min(1).max(1_000),
  })
  .strict();

export const diagnosticsResponseSchema = z
  .object({
    phase: z.enum(diagnosticsPhases),
    review_status: z.literal("staff_review_required"),
    answer: z.string().min(1).max(8_000),
    assessments: z.array(evidenceAssessmentSchema).max(8),
    requested_input: requestedInputSchema,
    next_step: z.string().min(1).max(750),
    safety: safetySchema,
    sources: z.array(sourceSchema).max(12),
    source_summary: z.string().min(1).max(1_000),
    limitations: z.array(z.string().min(1).max(500)).max(12),
    shop_log_entry: diagnosticsShopLogSchema.nullable(),
  })
  .strict();

export type DiagnosticsResponse = z.infer<typeof diagnosticsResponseSchema>;
export type DiagnosticsRequestedInput = DiagnosticsResponse["requested_input"];
export type DiagnosticsShopLog = z.infer<typeof diagnosticsShopLogSchema>;
