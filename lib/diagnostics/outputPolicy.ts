import type {
  DiagnosticsMode,
  DiagnosticsResponse,
  DiagnosticsShopLog,
} from "@/lib/diagnostics/responseSchema";
import {
  extractDiagnosticsPriceCents,
  extractDiagnosticsTechnicalValueMatches,
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
  allowedMeasuredValues?: string[];
  allowedSpecificationValues?: string[];
  allowedPriceCents?: number[];
  availableNamedReferences?: string[];
  hasProvidedReferenceEvidence?: boolean;
  includedReferenceEvidence?: string[];
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

function hasPositiveClaim(
  fields: string[],
  pattern: RegExp,
  acceptMatch?: (sentence: string, match: RegExpMatchArray) => boolean
): boolean {
  return fields.some((field) => {
    const sentences = field.split(/(?<=[.!?])\s+|\r?\n/);
    return sentences.some((sentence) => {
      const matcher = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
      for (const match of sentence.matchAll(matcher)) {
        if (match.index === undefined) continue;
        const before = sentence.slice(0, match.index);
        const clause = before.slice(
          Math.max(
            before.lastIndexOf(","),
            before.lastIndexOf(";"),
            before.lastIndexOf(":")
          ) + 1
        );
        if (
          /\b(?:once|after|before|if|whether|until|when)\b/i.test(clause) ||
          /\b(?:retest|test|check|inspect|measure)\s+to\s+(?:confirm|determine|verify)\b/i.test(
            clause
          ) ||
          /\b(?:check|confirm|determine)\s+whether\b/i.test(clause) ||
          /\b(?:not|never|cannot|can't|do not|don't|must not|no evidence|avoid claiming)\b(?:\W+\w+){0,3}\W*$/i.test(
            clause
          )
        ) {
          continue;
        }
        if (acceptMatch && !acceptMatch(sentence, match)) continue;
        return true;
      }
      return false;
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

function hasCompletedWorkClaim(fields: string[]): boolean {
  const completedVerb = String.raw`(?:replaced|repaired|installed|fixed)`;
  const actualAgent = new RegExp(
    String.raw`\b(?:we|(?:the\s+)?technician|(?:the\s+)?shop)\s+(?:(?:have|has)\s+)?${completedVerb}\b`,
    "i"
  );
  if (hasPositiveClaim(fields, actualAgent)) return true;

  const historicalActor = /\b(?:customer|owner|previous[- ]owner|aftermarket)\b/i;
  const proposed =
    /\b(?:may|might|could|should|would|will|need(?:s|ed)?|recommend(?:ation|ed|s)?|suggest(?:ion|ed|s)?|if|once|after|before|whether|until|when|retest|check|inspect|measure|not|never|cannot|can't|don't|to|be)\b/i;
  const passive = new RegExp(
    String.raw`((?:\b[\w'-]+\s+){0,6})(?:was|were|has\s+been|have\s+been)\s+${completedVerb}\b`,
    "i"
  );
  if (
    hasPositiveClaim(fields, passive, (sentence, match) => {
      const subject = match[1] ?? "";
      const before = sentence.slice(0, match.index ?? 0);
      const after = sentence.slice((match.index ?? 0) + match[0].length, 160);
      return (
        !historicalActor.test(subject) &&
        !historicalActor.test(before) &&
        !proposed.test(subject) &&
        !proposed.test(before) &&
        !/^\s*(?:by|for)\s+(?:the\s+)?(?:customer|owner|previous[- ]owner)\b/i.test(after)
      );
    })
  ) {
    return true;
  }

  const terse = new RegExp(String.raw`((?:\b[\w'-]+\s+){1,5})${completedVerb}\b`, "i");
  if (
    hasPositiveClaim(fields, terse, (sentence, match) => {
      const subject = match[1] ?? "";
      const before = sentence.slice(0, match.index ?? 0);
      const after = sentence.slice((match.index ?? 0) + match[0].length, 160);
      return (
        !historicalActor.test(subject) &&
        !historicalActor.test(before) &&
        !proposed.test(subject) &&
        !proposed.test(before) &&
        !/^\s*(?:by|for)\s+(?:the\s+)?(?:customer|owner|previous[- ]owner)\b/i.test(after)
      );
    })
  ) {
    return true;
  }

  const sentenceBeginning = new RegExp(String.raw`^\s*${completedVerb}\b`, "i");
  if (
    hasPositiveClaim(fields, sentenceBeginning, (sentence, match) => {
      if (/^\s*fixed\s+(?:range|interval)\b/i.test(sentence)) return false;
      const after = sentence.slice((match.index ?? 0) + match[0].length);
      return !/\bby\s+(?:the\s+)?(?:customer|owner|previous[- ]owner)\b/i.test(after);
    })
  ) {
    return true;
  }

  const completionStatus =
    /\b(?:repair|work|job)\s+(?:is|was|has\s+been)\s+complete(?:d)?\b/i;
  if (
    hasPositiveClaim(fields, completionStatus, (sentence, match) => {
      const before = sentence.slice(0, match.index ?? 0);
      const after = sentence.slice((match.index ?? 0) + match[0].length);
      return (
        !historicalActor.test(before) &&
        !proposed.test(before) &&
        !/\bby\s+(?:the\s+)?(?:customer|owner|previous[- ]owner)\b/i.test(after)
      );
    })
  ) {
    return true;
  }

  return hasPositiveClaim(
    fields,
    /\bwe\s+(?:have\s+)?completed\s+(?:the\s+)?(?:repair|work|job)\b/i
  );
}

function isExplicitNoCompletedWork(value: string): boolean {
  return /^(?:none|not (?:performed|recorded)|pending|repairs? (?:not (?:performed|recorded)|pending)|no (?:repairs?|work)(?: (?:was|were))? (?:performed|recorded))$/i.test(
    value.trim().replace(/[.!]+$/, "")
  );
}

function isExplicitNoVerification(value: string): boolean {
  return /^(?:none|(?:verification\s+)?(?:not verified|pending|not supplied|not performed))$/i.test(
    value.trim().replace(/[.!]+$/, "")
  );
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
    "measure",
    "measurement",
    "test",
    "result",
    "reading",
    "inspect",
    "photograph",
    "provide",
    "confirm",
    "obtain",
    "using",
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
  if ([...promptTokens].some((token) => nextTokens.has(token))) return true;

  const semanticPrompt = prompt.toLowerCase();
  const semanticNext = output.next_step.toLowerCase();
  const semanticPatterns: Partial<
    Record<DiagnosticsResponse["requested_input"]["type"], RegExp>
  > = {
    measurement:
      /\b(?:measure|meter|multimeter|reading|voltage|potential|pressure|clearance|resistance|current|amperage|temperature|continuity)\b/,
    technical_data:
      /\b(?:manual|source|specification|technical data|wiring diagram|bulletin|limit)\b/,
    photo: /\b(?:photo|photograph|picture|image|show)\b/,
    test_result: /\b(?:test|result|reading|record|measure|observe|measurement)\b/,
    question: /\b(?:ask|confirm|describe|state|provide|report|explain)\b/,
  };
  if (!semanticPatterns[output.requested_input.type]?.test(semanticNext)) return false;

  const domains = [
    /\b(?:battery|voltage|potential|electrical|terminal|posts?)\b/,
    /\b(?:pressure|tire|tyre|gauge)\b/,
    /\b(?:brake|rotor|disc|pad|caliper)\b/,
    /\b(?:clearance|gap|distance)\b/,
    /\b(?:resistance|ohms?|continuity)\b/,
    /\b(?:current|amps?|amperage)\b/,
    /\b(?:temperature|celsius|fahrenheit|heat)\b/,
    /\b(?:manual|source|specification|diagram|bulletin|limit)\b/,
  ];
  const promptDomains = domains.filter((domain) => domain.test(semanticPrompt));
  return (
    promptDomains.length === 0 ||
    promptDomains.some((domain) => domain.test(semanticNext))
  );
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

function normalizedSourceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasMatchingProvidedReference(
  sourceText: string,
  claims: DiagnosticsClaimContext
): boolean {
  if (!claims.hasProvidedReferenceEvidence) return false;
  const source = normalizedSourceText(sourceText);
  return (claims.includedReferenceEvidence ?? []).some((evidence) => {
    const included = normalizedSourceText(evidence);
    return Boolean(included && (included.includes(source) || source.includes(included)));
  });
}

function isMeasuredTechnicalUse(text: string, index: number, end: number): boolean {
  const clauseStart = Math.max(
    text.lastIndexOf(".", index - 1),
    text.lastIndexOf(";", index - 1),
    text.lastIndexOf("\n", index - 1)
  );
  const clauseEndCandidates = [
    text.indexOf(".", end),
    text.indexOf(";", end),
    text.indexOf("\n", end),
  ].filter((value) => value >= 0);
  const clauseEnd =
    clauseEndCandidates.length > 0 ? Math.min(...clauseEndCandidates) : text.length;
  const clause = text.slice(clauseStart + 1, clauseEnd);
  const relativeIndex = index - clauseStart - 1;
  const before = clause.slice(Math.max(0, relativeIndex - 80), relativeIndex);
  const after = clause.slice(relativeIndex + (end - index), relativeIndex + 60);
  const specification =
    /\b(?:spec(?:ification)?|limit|setpoint|threshold|target|maximum|minimum|max|min|required|requirement|should|must|expect(?:ed)?|capacity|clearance|interval|torque|tighten|set)\b/i;
  if (specification.test(before) || specification.test(after)) return false;
  return (
    /\b(?:measur(?:e[ds]?|ement)|record(?:ed|ing)?|reading|actual|found|observed|result(?:ed)?|show(?:ed|s)|tested)\b/i.test(
      before
    ) ||
    /^\s*(?:was\s+)?(?:measur(?:ed|ement)|recorded|observed|found|reading)\b/i.test(after)
  );
}

function percentageHasTechnicalContext(
  text: string,
  index: number,
  end: number
): boolean {
  const start = Math.max(
    text.lastIndexOf(".", index - 1),
    text.lastIndexOf(";", index - 1),
    text.lastIndexOf("\n", index - 1)
  );
  const nextBoundaries = [
    text.indexOf(".", end),
    text.indexOf(";", end),
    text.indexOf("\n", end),
  ].filter((value) => value >= 0);
  const finish = nextBoundaries.length > 0 ? Math.min(...nextBoundaries) : text.length;
  return /\b(?:spec(?:ification)?|limit|setpoint|mixture|measur(?:e[ds]?|ement)|reading|recorded)\b/i.test(
    text.slice(start + 1, finish)
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
    const sourceText = `${source.label} ${source.citation ?? ""}`;
    const normalizedSource = normalizedSourceText(sourceText);
    const namesExactModelSource =
      /\b(?:manual|oem|factory|bulletin|tsb|wiring(?: diagram)?)\b/.test(
        normalizedSource
      );
    const namesRecallSource = /\brecall\b/.test(normalizedSource);
    const namesOntarioRegulatorySource =
      /\b(?:ontario|o reg|regulation|inspection standard|inspection program)\b/.test(
        normalizedSource
      );
    if (
      source.status === "consulted" &&
      (source.authority === "official_oem" ||
        source.authority === "model_specific" ||
        namesExactModelSource) &&
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
    if (
      source.status === "consulted" &&
      (source.authority === "regulatory" ||
        namesRecallSource ||
        namesOntarioRegulatorySource)
    ) {
      if (namesRecallSource && !claims.hasCurrentRecallSource) {
        violations.push({
          code: "SOURCE_RECALL_UNAVAILABLE",
          message: "Recall status requires a supplied current official source.",
        });
      } else if (
        namesOntarioRegulatorySource &&
        !claims.hasCurrentOntarioInspectionSource
      ) {
        violations.push({
          code: "SOURCE_REGULATORY_UNAVAILABLE",
          message: "The matching current official regulatory source was not supplied.",
        });
      } else if (!namesRecallSource && !namesOntarioRegulatorySource) {
        violations.push({
          code: "SOURCE_REGULATORY_UNAVAILABLE",
          message: "The regulatory source cannot be matched to supplied evidence.",
        });
      }
    }
    if (
      source.status === "consulted" &&
      source.authority === "provided_reference" &&
      !hasMatchingProvidedReference(sourceText, claims)
    ) {
      violations.push({
        code: "SOURCE_REFERENCE_UNAVAILABLE",
        message:
          "A provided reference cannot be consulted unless its evidence was included.",
      });
    }
    if (
      source.status === "consulted" &&
      (() => {
        const normalized = normalizedSource;
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
    /\b(?:(?:(?:the\s+)?(?:bike|motorcycle|vehicle)\s+(?:is|was|has been)|it(?:\s+(?:is|was|has been)|'s))(?:\s+now)?\s+(?:safe\s+to\s+(?:ride|operate|use)|ok(?:ay)?\s+to\s+ride)|(?:(?!(?:once|after|before|if|whether|until|when|retest|test|check|inspect|measure|confirm|determine|to|the|do|not|never|claim|say)\b)[\w'-]+\s+){1,6}(?:is|was|has been|'s)(?:\s+now)?\s+(?:safe|ok(?:ay)?)\s+to\s+(?:ride|operate)|^\s*(?:safe|ok(?:ay)?)\s+to\s+(?:ride|operate)|(?!(?:once|after|before|if|whether|until|when|retest|test|check|inspect|measure|confirm|determine|to|the)\b)(?:[\w'-]+\s+){0,5}[\w'-]+\s+(?:is|was|has been|'s)(?:\s+now)?\s+roadworthy|pass(?:es|ed)\s+(?:the\s+)?(?:safety\s+inspection|safety|inspection)|cleared\s+for\s+release|ready\s+for\s+pickup)\b/i,
    "ROADWORTHINESS_CLAIM",
    "The draft makes an unsupported inspection or roadworthiness claim."
  );
  addPositiveViolation(
    violations,
    fields,
    claims.hasRecordedCustomerAuthorization,
    /\b(?:(?:customer|client)\s+(?:(?:has\s+)?approved|authorized|gave\s+approval)|(?:repair|work|estimate)\s+(?:is|was|has been)\s+approved(?:\s+by\s+(?:the\s+)?customer)?|approved\s+by\s+(?:the\s+)?customer|(?:authorization|approval)\s+(?:(?:is|was|has been)\s+)?(?:received|confirmed|granted))\b/i,
    "AUTHORIZATION_CLAIM",
    "The draft claims customer authorization without a supplied record."
  );
  if (!claims.hasRecordedCompletedWork && hasCompletedWorkClaim(fields)) {
    violations.push({
      code: "COMPLETED_WORK_CLAIM",
      message: "The draft claims completed work without a supplied record.",
    });
  }
  addPositiveViolation(
    violations,
    fields,
    claims.hasVerificationEvidence,
    /\b(?:(?!(?:once|after|before|if|whether|until|when|retest|test|check|inspect|measure|confirm|determine|to|the)\b)(?:[\w-]+\s+){0,3}(?:system|component|repair|work|operation|bike|motorcycle|it)\s+(?:is|was|has been)\s+verified|(?:(?!(?:once|after|before|if|whether|until|when|retest|test|check|inspect|measure|confirm|determine|to|the|may|might|could|should|would|will|be)\b)[\w-]+\s+){1,4}verified\s+after\s+(?:the\s+)?repair|verification\s+(?:passed|is complete|was completed)|(?:(?:original\s+)?(?:complaint|symptom))\s+(?:is|was|has been)?\s*(?:resolved|fixed)|complaint\s+resolved)\b/i,
    "VERIFICATION_CLAIM",
    "The draft claims successful verification without a supplied retest result."
  );
  if (output.shop_log_entry) {
    if (
      !claims.hasRecordedCompletedWork &&
      !isExplicitNoCompletedWork(output.shop_log_entry.repairs_performed) &&
      !violations.some((violation) => violation.code === "COMPLETED_WORK_CLAIM")
    ) {
      violations.push({
        code: "COMPLETED_WORK_CLAIM",
        message:
          "Shop Log repairs must remain explicitly unrecorded without completed-work evidence.",
      });
    }
    if (
      !claims.hasVerificationEvidence &&
      !isExplicitNoVerification(output.shop_log_entry.verification) &&
      !violations.some((violation) => violation.code === "VERIFICATION_CLAIM")
    ) {
      violations.push({
        code: "VERIFICATION_CLAIM",
        message:
          "Shop Log verification must remain explicitly unverified without recorded evidence.",
      });
    }
  }
  addClaimViolation(
    violations,
    text,
    claims.hasExactModelSource,
    /\baccording to\s+(?:the\s+)?(?:oem|factory|service)\s+manual\b|\bper\s+(?:the\s+)?(?:oem|factory|service)\s+manual\b|\bthe\s+(?:oem|factory|service)\s+manual\s+(?:states|specifies|requires)\b/i,
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
  const legacyTechnicalValues = claims.allowedTechnicalValues ?? [];
  const measuredTechnicalValues = new Set(
    claims.allowedMeasuredValues ?? legacyTechnicalValues
  );
  const specificationTechnicalValues = new Set(
    claims.allowedSpecificationValues ?? legacyTechnicalValues
  );
  const unsupportedTechnical = fields.flatMap((field) =>
    extractDiagnosticsTechnicalValueMatches(field)
      .filter(
        (match) =>
          !match.normalized.endsWith(":percent") ||
          percentageHasTechnicalContext(field, match.index, match.end)
      )
      .filter((match) =>
        isMeasuredTechnicalUse(field, match.index, match.end)
          ? !measuredTechnicalValues.has(match.normalized)
          : !specificationTechnicalValues.has(match.normalized)
      )
      .map((match) => match.normalized)
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
        ? output.sources
            .map(
              (source) =>
                `${source.label} — ${source.authority} — ${source.status}${
                  source.citation ? ` — ${source.citation}` : ""
                }`
            )
            .join("; ")
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
