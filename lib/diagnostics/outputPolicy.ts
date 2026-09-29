import type {
  DiagnosticsMode,
  DiagnosticsResponse,
  DiagnosticsShopLog,
} from "@/lib/diagnostics/responseSchema";
import {
  extractDiagnosticsPriceCents,
  extractDiagnosticsTechnicalValues,
} from "@/lib/diagnostics/evidence";

export type DiagnosticsClaimContext = {
  hasRecordedCustomerAuthorization?: boolean;
  hasRecordedCompletedWork?: boolean;
  hasVerificationEvidence?: boolean;
  hasExactModelSource?: boolean;
  hasCurrentRecallSource?: boolean;
  hasCurrentOntarioInspectionSource?: boolean;
  hasSuppliedPrices?: boolean;
  allowedTechnicalValues?: string[];
  allowedPriceCents?: number[];
  availableNamedReferences?: string[];
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

function outputTextFields(output: DiagnosticsResponse): string[] {
  return [
    output.answer,
    output.next_step,
    output.requested_input.prompt,
    output.requested_input.purpose,
    output.requested_input.tool_placement,
    output.requested_input.conditions,
    output.safety.boundary,
    output.source_summary,
    ...output.assessments.flatMap((item) => [
      item.conclusion,
      ...item.evidence,
      item.confirming_test,
    ]),
    ...output.sources.flatMap((item) => [item.label, item.citation, item.applies_to]),
    ...output.limitations,
    ...(output.shop_log_entry ? Object.values(output.shop_log_entry) : []),
  ].filter((value): value is string => typeof value === "string");
}

function hasPositiveClaim(fields: string[], pattern: RegExp): boolean {
  return fields.some((field) => {
    const sentences = field.split(/(?<=[.!?])\s+|\r?\n/);
    return sentences.some((sentence) => {
      const match = sentence.match(pattern);
      if (!match || match.index === undefined) return false;
      const before = sentence.slice(0, match.index).toLowerCase();
      return !/\b(?:not|never|cannot|can't|do not|don't|must not|no evidence|avoid claiming)\b/.test(
        before
      );
    });
  });
}

function addPositiveViolation(
  violations: DiagnosticsPolicyViolation[],
  fields: string[],
  allowed: boolean | undefined,
  pattern: RegExp,
  code: string,
  message: string
): void {
  if (!allowed && hasPositiveClaim(fields, pattern)) {
    violations.push({ code, message });
  }
}

function requestedInputMatchesNextStep(output: DiagnosticsResponse): boolean {
  if (output.requested_input.type === "none") return true;
  const prompt = output.requested_input.prompt;
  if (!prompt) return false;
  const ignored = new Set([
    "the",
    "and",
    "with",
    "from",
    "while",
    "then",
    "this",
    "that",
    "your",
    "please",
    "record",
  ]);
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((token) => token.length >= 4 && !ignored.has(token)) ?? []
    );
  const promptTokens = tokens(prompt);
  const nextTokens = tokens(output.next_step);
  return [...promptTokens].some((token) => nextTokens.has(token));
}

function hasMultipleActions(value: string): boolean {
  const numberedActions = value.match(/(?:^|\s)\d+[.)]\s+\S+/g)?.length ?? 0;
  return (
    /[\r\n]\s*(?:[-*]|\d+[.)])\s+/.test(value) ||
    numberedActions > 1 ||
    /;\s*(?:measure|inspect|replace|test|record|photograph|check|remove|install)\b/i.test(
      value
    ) ||
    /\band\s+then\s+(?:measure|inspect|replace|test|record|photograph|check|remove|install)\b/i.test(
      value
    )
  );
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
  const fields = outputTextFields(output);

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

  if (hasMultipleActions(output.next_step)) {
    violations.push({
      code: "MULTIPLE_NEXT_STEPS",
      message: "NEXT STEP must contain one concrete action, not a list.",
    });
  }

  if (
    output.requested_input.prompt &&
    hasMultipleActions(output.requested_input.prompt)
  ) {
    violations.push({
      code: "MULTIPLE_REQUESTED_INPUTS",
      message: "The requested input must contain exactly one action.",
    });
  }

  if (!requestedInputMatchesNextStep(output)) {
    violations.push({
      code: "NEXT_STEP_INPUT_MISMATCH",
      message: "The requested input and NEXT STEP must describe the same action.",
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

  for (const source of output.sources) {
    if (
      source.status === "consulted" &&
      (source.authority === "official_oem" || source.authority === "model_specific") &&
      !claims.hasExactModelSource
    ) {
      violations.push({
        code: "SOURCE_EXACT_MODEL_UNAVAILABLE",
        message: "An exact-model source cannot be consulted when none was supplied.",
      });
    }
    if (source.status === "consulted" && source.authority === "unverified") {
      violations.push({
        code: "UNVERIFIED_SOURCE_CONSULTED",
        message: "An unverified reference cannot be marked consulted.",
      });
    }
    if (source.status === "consulted" && source.authority === "regulatory") {
      const sourceText = `${source.label} ${source.applies_to}`.toLowerCase();
      if (/recall/.test(sourceText) && !claims.hasCurrentRecallSource) {
        violations.push({
          code: "SOURCE_RECALL_UNAVAILABLE",
          message: "Recall status requires a supplied current official source.",
        });
      } else if (
        /(ontario|inspection|regulation|law)/.test(sourceText) &&
        !claims.hasCurrentOntarioInspectionSource
      ) {
        violations.push({
          code: "SOURCE_REGULATORY_UNAVAILABLE",
          message: "The matching current official regulatory source was not supplied.",
        });
      } else if (!/(recall|ontario|inspection|regulation|law)/.test(sourceText)) {
        violations.push({
          code: "SOURCE_REGULATORY_UNAVAILABLE",
          message: "The regulatory source cannot be matched to supplied evidence.",
        });
      }
    }
    if (
      source.status === "consulted" &&
      (() => {
        const normalized = `${source.label} ${source.citation ?? ""}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ");
        const referenceName = /universal diagnostic tree/.test(normalized)
          ? "universalDiagnosticTree"
          : /visual motorcycle inspection report/.test(normalized)
            ? "officialInspectionTemplate"
            : null;
        const namedUnavailable =
          referenceName !== null || /local codex|earlier .* pdf/.test(normalized);
        return (
          namedUnavailable &&
          (!referenceName || !claims.availableNamedReferences?.includes(referenceName))
        );
      })()
    ) {
      violations.push({
        code: "NAMED_SOURCE_UNAVAILABLE",
        message: "A named unavailable resource cannot be marked consulted.",
      });
    }
  }

  addPositiveViolation(
    violations,
    fields,
    false,
    /\b(?:(?:the\s+)?(?:bike|motorcycle|it)(?:\s+is|'s)(?:\s+now)?\s+(?:safe(?:\s+to\s+(?:ride|operate))?|roadworthy|ok(?:ay)?\s+to\s+ride)|(?:safe|ok(?:ay)?)\s+to\s+ride|(?:bike|motorcycle)\s+(?:passes|passed)\s+(?:the\s+)?(?:safety|inspection))\b/i,
    "ROADWORTHINESS_CLAIM",
    "The draft makes an unsupported inspection or roadworthiness claim."
  );
  addPositiveViolation(
    violations,
    fields,
    claims.hasRecordedCustomerAuthorization,
    /\b(?:(?:customer|client)\s+(?:has\s+)?approved|(?:repair|work|estimate)\s+(?:is|was|has been)\s+approved(?:\s+by\s+(?:the\s+)?customer)?|approved\s+by\s+(?:the\s+)?customer|authorization\s+(?:is|was|has been)\s+(?:received|confirmed|granted))\b/i,
    "AUTHORIZATION_CLAIM",
    "The draft claims customer authorization without a supplied record."
  );
  addPositiveViolation(
    violations,
    fields,
    claims.hasRecordedCompletedWork,
    /\b(?:(?:we|the\s+(?:technician|shop))\s+(?:have\s+|has\s+)?(?:repaired|replaced|installed|completed|fixed)|(?:repair|work)\s+(?:is|was|has been)?\s*complete(?:d)?|(?:starter|battery|relay|wiring|component|part)\s+(?:was\s+|has been\s+)?(?:repaired|replaced|installed|fixed)|(?:repaired|replaced|installed|fixed)\s+(?:the\s+)?(?:starter|battery|relay|wiring|component|part))\b/i,
    "COMPLETED_WORK_CLAIM",
    "The draft claims completed work without a supplied record."
  );
  addPositiveViolation(
    violations,
    fields,
    claims.hasVerificationEvidence,
    /\b(?:(?:repair|work)\s+(?:is|was|has been)\s+verified|verification\s+(?:passed|is complete|was completed)|(?:(?:original\s+)?(?:complaint|symptom))\s+(?:is|was|has been)?\s*(?:resolved|fixed)|complaint\s+resolved)\b/i,
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
  const suppliedTechnicalValues = new Set(claims.allowedTechnicalValues ?? []);
  const technicalValues = extractDiagnosticsTechnicalValues(text);
  const unsupportedTechnical = technicalValues.filter(
    (value) => !suppliedTechnicalValues.has(value)
  );
  if (unsupportedTechnical.length > 0) {
    violations.push({
      code: "UNSOURCED_TECHNICAL_VALUE",
      message: "The draft contains a technical value not present in verified evidence.",
    });
    if (unsupportedTechnical.some((value) => /:(?:nm|ftlb)$/.test(value))) {
      violations.push({
        code: "UNSOURCED_TORQUE",
        message: "The draft contains a torque value without the exact supplied value.",
      });
    }
  }

  const allowedPriceCents = new Set(claims.allowedPriceCents ?? []);
  if (
    extractDiagnosticsPriceCents(text).some((amount) => !allowedPriceCents.has(amount))
  ) {
    violations.push({
      code: "UNSUPPLIED_PRICE",
      message: "The draft contains a price amount not present in stored pricing.",
    });
  }

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
  const safetyFlags = [
    output.safety.stop_work ? "STOP WORK" : null,
    output.safety.do_not_ride ? "DO NOT RIDE" : null,
  ].filter(Boolean);
  const safetyLabel = safetyFlags.length > 0 ? safetyFlags.join(" / ") : "BOUNDARY";
  const sections = [
    `**SAFETY — ${safetyLabel}:** ${
      output.safety.boundary ?? "No additional safety boundary stated."
    }`,
    "AI draft — staff review required",
    `**Assessments:** ${
      output.assessments.length > 0
        ? output.assessments
            .map(
              (item) =>
                `${item.confidence}: ${item.conclusion} Evidence: ${item.evidence.join(
                  "; "
                )}${
                  item.confirming_test ? ` Confirming test: ${item.confirming_test}` : ""
                }`
            )
            .join("\n")
        : "No assessment supplied."
    }`,
    output.answer.trim(),
    `**Sources/status:** ${
      output.sources.length > 0
        ? output.sources.map((source) => `${source.label} — ${source.status}`).join("; ")
        : "No sources supplied."
    }\n${output.source_summary}`,
    `**Limitations:** ${
      output.limitations.length > 0 ? output.limitations.join("; ") : "None stated."
    }`,
    `**NEXT STEP:** ${output.next_step.trim()}`,
  ];

  if (output.shop_log_entry) {
    sections.push(`**Shop Log Entry:** ${formatShopLog(output.shop_log_entry)}`);
  }

  return sections.join("\n\n");
}
