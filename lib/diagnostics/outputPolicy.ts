import type {
  DiagnosticsMode,
  DiagnosticsResponse,
  DiagnosticsShopLog,
} from "@/lib/diagnostics/responseSchema";

export type DiagnosticsClaimContext = {
  hasRecordedCustomerAuthorization?: boolean;
  hasRecordedCompletedWork?: boolean;
  hasVerificationEvidence?: boolean;
  hasExactModelSource?: boolean;
  hasCurrentRecallSource?: boolean;
  hasCurrentOntarioInspectionSource?: boolean;
  hasSuppliedPrices?: boolean;
};

export type DiagnosticsPolicyViolation = {
  code: string;
  message: string;
};

export class DiagnosticsOutputPolicyError extends Error {
  readonly violations: DiagnosticsPolicyViolation[];

  constructor(violations: DiagnosticsPolicyViolation[]) {
    super("DIAGNOSTICS_AI_OUTPUT_WITHHELD");
    this.name = "DiagnosticsOutputPolicyError";
    this.violations = violations;
  }
}

function generatedText(output: DiagnosticsResponse): string {
  return JSON.stringify(output);
}

function addClaimViolation(
  violations: DiagnosticsPolicyViolation[],
  text: string,
  allowed: boolean | undefined,
  pattern: RegExp,
  code: string,
  message: string
): void {
  if (!allowed && pattern.test(text)) violations.push({ code, message });
}

export function inspectDiagnosticsOutput(
  output: DiagnosticsResponse,
  options: {
    mode: DiagnosticsMode;
    claims?: DiagnosticsClaimContext;
  }
): DiagnosticsPolicyViolation[] {
  const violations: DiagnosticsPolicyViolation[] = [];
  const claims = options.claims ?? {};
  const text = generatedText(output);

  if (output.requested_input.type === "none") {
    if (output.requested_input.prompt !== null) {
      violations.push({
        code: "NONE_INPUT_HAS_PROMPT",
        message: "A no-input response cannot request additional evidence.",
      });
    }
  } else if (!output.requested_input.prompt) {
    violations.push({
      code: "REQUEST_PROMPT_MISSING",
      message: "The requested input needs a concrete prompt.",
    });
  }

  if (/[\r\n]\s*(?:[-*]|\d+[.)])\s+/.test(output.next_step)) {
    violations.push({
      code: "MULTIPLE_NEXT_STEPS",
      message: "NEXT STEP must contain one concrete action, not a list.",
    });
  }

  if (options.mode === "report" && output.shop_log_entry === null) {
    violations.push({
      code: "REPORT_SHOP_LOG_MISSING",
      message: "Reports require a compact Shop Log Entry.",
    });
  }

  if (
    output.phase === "ready_for_technician_verification" &&
    !claims.hasRecordedCompletedWork
  ) {
    violations.push({
      code: "WORK_NOT_RECORDED",
      message: "Verification-ready status requires a supplied completed-work record.",
    });
  }

  addClaimViolation(
    violations,
    text,
    false,
    /\b(?:is|was|has been)\s+(?:roadworthy|certified|safe to (?:ride|operate))\b|\bpass(?:es|ed)?\s+(?:the\s+)?(?:safety|inspection)\b/i,
    "ROADWORTHINESS_CLAIM",
    "The draft makes an unsupported inspection or roadworthiness claim."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasRecordedCustomerAuthorization,
    /\b(?:customer|client)\s+(?:has\s+)?approved\b|\bauthorization\s+(?:is|was|has been)\s+(?:received|confirmed|granted)\b/i,
    "AUTHORIZATION_CLAIM",
    "The draft claims customer authorization without a supplied record."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasRecordedCompletedWork,
    /\b(?:we|the\s+(?:technician|shop))\s+(?:have\s+|has\s+)?(?:repaired|replaced|installed|completed|fixed)\b|\brepair\s+(?:is|was|has been)\s+complete\b/i,
    "COMPLETED_WORK_CLAIM",
    "The draft claims completed work without a supplied record."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasVerificationEvidence,
    /\b(?:repair|work)\s+(?:is|was|has been)\s+verified\b|\bverification\s+(?:passed|is complete|was completed)\b|\boriginal\s+(?:complaint|symptom)\s+(?:is|was|has been)\s+(?:resolved|fixed)\b/i,
    "VERIFICATION_CLAIM",
    "The draft claims successful verification without a supplied retest result."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasExactModelSource,
    /\baccording to\s+(?:the\s+)?(?:oem|factory|service)\s+manual\b|\bthe\s+(?:oem|factory|service)\s+manual\s+(?:states|specifies|requires)\b/i,
    "UNREAD_MANUAL_CLAIM",
    "The draft claims access to an exact-model manual that was not supplied."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasExactModelSource,
    /\b\d+(?:\.\d+)?\s*(?:n\s*[·.-]?\s*m|ft[ -]?lb|lb[ -]?ft)\b/i,
    "UNSOURCED_TORQUE",
    "The draft contains a torque value without a verified exact-model source."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasCurrentRecallSource,
    /\bno\s+(?:open\s+|outstanding\s+)?recalls?\b|\brecall\s+status\s+(?:is\s+)?(?:clear|none)\b/i,
    "RECALL_STATUS_CLAIM",
    "The draft claims recall status without a current official lookup."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasCurrentOntarioInspectionSource,
    /\bontario\s+(?:law|regulation|inspection\s+(?:standard|program))\s+(?:requires|allows|prohibits|says)\b/i,
    "ONTARIO_REQUIREMENT_CLAIM",
    "The draft claims an Ontario requirement without a current official source."
  );
  addClaimViolation(
    violations,
    text,
    claims.hasSuppliedPrices,
    /(?:^|[\s(])\$\s?\d+(?:[,.]\d{2})?\b|\b(?:cad|usd)\s?\d+(?:[,.]\d{2})?\b/i,
    "UNSUPPLIED_PRICE",
    "The draft contains a price that was not supplied."
  );

  return violations;
}

export function assertDiagnosticsOutputAllowed(
  output: DiagnosticsResponse,
  options: {
    mode: DiagnosticsMode;
    claims?: DiagnosticsClaimContext;
  }
): void {
  const violations = inspectDiagnosticsOutput(output, options);
  if (violations.length > 0) throw new DiagnosticsOutputPolicyError(violations);
}

function formatShopLog(log: DiagnosticsShopLog): string {
  return [
    log.date_time ?? "date/time not supplied",
    log.bike_or_ro,
    `Complaint: ${log.complaint}`,
    `Tests/conditions: ${log.tests_and_conditions}`,
    `Results/units: ${log.results_and_units}`,
    `Conclusions/confidence: ${log.conclusions_and_confidence}`,
    `Repairs performed: ${log.repairs_performed}`,
    `Verification: ${log.verification}`,
    `Authorization: ${log.authorization}`,
    `Open items: ${log.open_items}`,
  ].join(" | ");
}

export function renderDiagnosticsDraft(output: DiagnosticsResponse): string {
  const sections = [
    "AI draft — staff review required",
    output.answer.trim(),
    `**NEXT STEP:** ${output.next_step.trim()}`,
  ];

  if (output.shop_log_entry) {
    sections.push(`**Shop Log Entry:** ${formatShopLog(output.shop_log_entry)}`);
  }

  return sections.join("\n\n");
}
