import { createHash } from "node:crypto";
import { extractDiagnosticsTechnicalValues } from "@/lib/diagnostics/evidence";
import type { DiagnosticsClaimContext } from "@/lib/diagnostics/outputPolicy";
import {
  buildUntrustedReferenceBlock,
  diagnosticsAudienceForMode,
  type DiagnosticsAudience,
} from "@/lib/diagnostics/prompts";
import {
  redactDiagnosticsText,
  type DiagnosticsRedactTerms,
} from "@/lib/diagnostics/redaction";
import type { DiagnosticsMode } from "@/lib/diagnostics/responseSchema";

export const DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS = 500;
export const DIAGNOSTICS_MAX_COLLECTION_ITEMS = 100;
export const DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS = 48_000;

const DEEP_MAX_DEPTH = 3;
const DEEP_MAX_ITEMS = 40;
const DEEP_GLOBAL_NODE_BUDGET = 24;
const DEEP_TEXT_CHARS = 80;
const SECTION_BUDGETS = {
  customerRequestJobs: 2_000,
  inspectionResults: 8_000,
  technicianNotes: 4_000,
  recommendations: 4_000,
  qualityChecks: 2_000,
  safetyChecks: 2_000,
  selectedJobParts: 2_500,
  selectedJobChecklist: 1_500,
  selectedJobVerification: 1_500,
} as const;

type NullableText = string | null | undefined;

export type DiagnosticsContextJobSource = {
  jobId: string;
  workOrderId: string;
  origin: string;
  serviceName: string;
  status: string;
  workState?: string | null;
  notes?: NullableText;
  completedAt?: string | null;
  prices?: {
    currency?: NullableText;
    laborCents?: number | null;
    partsCents?: number | null;
    feesCents?: number | null;
    discountCents?: number | null;
    taxCents?: number | null;
    totalCents?: number | null;
  } | null;
  authorization?: {
    decision: string;
    decidedAt: string;
    method?: NullableText;
    reason?: NullableText;
  } | null;
  parts?: Array<{
    partId: string;
    description: string;
    partNumber?: NullableText;
    quantityRequired?: number | null;
    quantityReceived?: number | null;
    quantityAllocated?: number | null;
    quantityInstalled?: number | null;
    state: string;
    notes?: NullableText;
    sellPriceCents?: number | null;
    supplierCostCents?: number | null;
  }>;
  checklist?: Array<{
    checklistItemId: string;
    title: string;
    checkedAt: string | null;
  }>;
  proof?: {
    required: boolean;
    photoCount: number;
    exceptionRecorded: boolean;
    photoUrls?: string[];
    storagePaths?: string[];
  } | null;
  verification?: Array<{
    verificationId: string;
    result: string;
    notes?: NullableText;
    recordedAt: string;
  }>;
};

export type DiagnosticsContextSource = {
  workOrder: {
    workOrderId: string;
    workOrderNumber: string;
    status: string;
    lifecycleState?: string | null;
    mileage?: number | null;
    complaint?: NullableText;
    internalNotes?: NullableText;
  };
  motorcycle: {
    year: number;
    make: string;
    model: string;
    colour?: NullableText;
    odometerUnit?: NullableText;
    vin?: NullableText;
    notes?: NullableText;
  };
  serviceInformation?: {
    oilFilter?: NullableText;
    oilType?: NullableText;
    oilCapacity?: NullableText;
    airFilter?: NullableText;
    sparkPlugs?: NullableText;
    frontBrakePads?: NullableText;
    rearBrakePads?: NullableText;
    frontTireSize?: NullableText;
    rearTireSize?: NullableText;
    chain?: NullableText;
    battery?: NullableText;
    notes?: NullableText;
  } | null;
  jobs: DiagnosticsContextJobSource[];
  inspection?: {
    inspectionId: string;
    workOrderId: string;
    completedAt: string | null;
    results: Array<{
      inspectionResultId: string;
      category: string;
      itemName: string;
      displayOrder: number;
      status: string | null;
      measurement: string | null;
      notes: string | null;
    }>;
  } | null;
  technicianNotes?: Array<{
    technicianNoteId: string;
    workOrderId: string;
    jobId: string | null;
    noteType: string;
    note: string;
    createdAt: string;
  }>;
  recommendations?: Array<{
    recommendationId: string;
    workOrderId: string;
    jobId?: string | null;
    description: string;
    severity: string;
    status: string;
    disposition?: string | null;
    notes?: NullableText;
  }>;
  checks?: {
    quality?: DiagnosticsCheckSource[];
    safety?: DiagnosticsCheckSource[];
  };
  references?: Partial<
    Record<DiagnosticsReferenceName, boolean | string | { text?: NullableText }>
  >;
};

type DiagnosticsCheckSource = {
  attemptId: string;
  workOrderId: string;
  outcome: string;
  checklist?: unknown;
  notes?: NullableText;
  performedAt: string;
};

export type DiagnosticsReferenceName =
  | "exactModelOem"
  | "currentRecallLookup"
  | "currentOntarioInspection"
  | "officialInspectionTemplate"
  | "universalDiagnosticTree";

export type DiagnosticsContextOptions = {
  mode: DiagnosticsMode;
  workOrderId: string;
  jobId?: string | null;
  serverNowIso?: string | null;
  redactTerms?: DiagnosticsRedactTerms;
};

export type DiagnosticsTruncation = {
  total: number;
  included: number;
  omitted: number;
  clipped: boolean;
};

type ShapedJob = {
  jobId: string;
  origin: string;
  serviceName: string;
  status: string;
  workState: string | null;
  notes: string | null;
  completedAt: string | null;
  parts: Array<{
    partId: string;
    description: string;
    partNumber: string | null;
    quantityRequired: number | null;
    quantityReceived: number | null;
    quantityAllocated: number | null;
    quantityInstalled: number | null;
    state: string;
    notes: string | null;
    sellPriceCents?: number | null;
  }>;
  checklist: Array<{
    checklistItemId: string;
    title: string;
    checked: boolean;
    checkedAt: string | null;
  }>;
  proof: {
    required: boolean;
    photoCount: number;
    exceptionRecorded: boolean;
  } | null;
  verification: Array<{
    verificationId: string;
    result: string;
    notes: string | null;
    recordedAt: string;
  }>;
  verificationEvidenceRecorded: boolean;
  pricing?: NonNullable<DiagnosticsContextJobSource["prices"]>;
  authorization?: NonNullable<DiagnosticsContextJobSource["authorization"]>;
  truncation: {
    parts: DiagnosticsTruncation;
    checklist: DiagnosticsTruncation;
    verification: DiagnosticsTruncation;
  };
};

export type DiagnosticsModelContext = {
  mode: DiagnosticsMode;
  audience: DiagnosticsAudience;
  contextAsOf: string | null;
  workOrder: {
    workOrderId: string;
    identifier: string;
    status: string;
    lifecycleState: string | null;
    mileage: { value: number | null; unit: string | null };
    complaint: string | null;
    internalNotes: string | null;
  };
  motorcycle: {
    year: number;
    make: string;
    model: string;
    colour: string | null;
    notes: string | null;
    source: "unverified_app_catalogue_reference";
    verified: false;
  };
  serviceInformation: {
    values: Record<string, string | null>;
    source: "unverified_app_catalogue_reference";
    verified: false;
  } | null;
  customerRequestJobs: Array<{
    jobId: string;
    serviceName: string;
    status: string;
    workState: string | null;
    notes: string | null;
  }>;
  selectedJob: ShapedJob | null;
  inspection: {
    available: boolean;
    completed: boolean;
    completedAt: string | null;
    results: Array<{
      inspectionResultId: string;
      category: string;
      itemName: string;
      displayOrder: number;
      status: string;
      measurement: string | null;
      notes: string | null;
    }>;
  };
  technicianNotes: Array<{
    technicianNoteId: string;
    jobId: string | null;
    noteType: string;
    note: string;
    createdAt: string;
  }>;
  recommendations: Array<{
    recommendationId: string;
    jobId: string | null;
    description: string;
    severity: string;
    status: string;
    disposition: string | null;
    notes: string | null;
  }>;
  checks: {
    quality: ShapedCheck[];
    safety: ShapedCheck[];
  };
  missingReferences: Record<DiagnosticsReferenceName, boolean>;
  referenceEvidence: Record<DiagnosticsReferenceName, string | null>;
  truncation: {
    customerRequestJobs: DiagnosticsTruncation;
    inspectionResults: DiagnosticsTruncation;
    technicianNotes: DiagnosticsTruncation;
    recommendations: DiagnosticsTruncation;
    qualityChecks: DiagnosticsTruncation;
    safetyChecks: DiagnosticsTruncation;
  };
};

declare const shapedDiagnosticsContextBrand: unique symbol;
export type ShapedDiagnosticsModelContext = DiagnosticsModelContext & {
  readonly [shapedDiagnosticsContextBrand]: true;
};

type ShapedCheck = {
  attemptId: string;
  outcome: string;
  checklist: unknown;
  notes: string | null;
  performedAt: string;
};

export type ShapedDiagnosticsContext = {
  context: ShapedDiagnosticsModelContext;
  contextBlock: string;
  contextHash: string;
  claims: DiagnosticsClaimContext;
};

const REFERENCE_NAMES: DiagnosticsReferenceName[] = [
  "exactModelOem",
  "currentRecallLookup",
  "currentOntarioInspection",
  "officialInspectionTemplate",
  "universalDiagnosticTree",
];

const SERVICE_INFORMATION_KEYS = [
  "oilFilter",
  "oilType",
  "oilCapacity",
  "airFilter",
  "sparkPlugs",
  "frontBrakePads",
  "rearBrakePads",
  "frontTireSize",
  "rearTireSize",
  "chain",
  "battery",
  "notes",
] as const;

function boundedText(value: NullableText): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const redacted = redactDiagnosticsText(normalized);
  if (!redacted) return null;
  if (redacted.length <= DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS) return redacted;
  const marker = "[CLIPPED]";
  return `${redacted.slice(
    0,
    DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS - marker.length
  )}${marker}`;
}

function boundedRequiredText(value: string): string {
  return boundedText(value) ?? "";
}

function sortedBounded<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...values].sort(compare).slice(0, DIAGNOSTICS_MAX_COLLECTION_ITEMS);
}

function budgetItems<T>(
  values: readonly T[],
  budget: number
): { items: T[]; truncation: DiagnosticsTruncation } {
  const items: T[] = [];
  let used = 2;
  for (const value of values.slice(0, DIAGNOSTICS_MAX_COLLECTION_ITEMS)) {
    const size = JSON.stringify(value).length + (items.length > 0 ? 1 : 0);
    if (used + size > budget) break;
    items.push(value);
    used += size;
  }
  const total = values.length;
  return {
    items,
    truncation: {
      total,
      included: items.length,
      omitted: total - items.length,
      clipped: items.length < total,
    },
  };
}

function redactSourceValues<T>(
  value: T,
  terms: DiagnosticsRedactTerms,
  redactStrings = false
): T {
  if (typeof value === "string") {
    return (redactStrings ? redactDiagnosticsText(value, terms) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSourceValues(item, terms, redactStrings)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        redactSourceValues(
          child,
          terms,
          redactStrings ||
            /^(?:complaint|internalNotes|notes?|description|reason|measurement|text|title|itemName|method|checklist|serviceName|result|serviceInformation|references)$/i.test(
              key
            )
        ),
      ])
    ) as T;
  }
  return value;
}

function byId<T>(getId: (value: T) => string): (a: T, b: T) => number {
  return (a, b) => getId(a).localeCompare(getId(b));
}

function assertSameWorkOrder(
  rows: readonly { workOrderId: string }[],
  workOrderId: string
): void {
  if (rows.some((row) => row.workOrderId !== workOrderId)) {
    throw new Error("DIAGNOSTICS_CONTEXT_WORK_ORDER_MISMATCH");
  }
}

function isFrontOffice(mode: DiagnosticsMode): boolean {
  return mode === "advisor" || mode === "intake";
}

function shapePricing(
  value: DiagnosticsContextJobSource["prices"]
): NonNullable<DiagnosticsContextJobSource["prices"]> | undefined {
  if (!value) return undefined;
  const pricing = {
    ...(boundedText(value.currency) ? { currency: boundedText(value.currency) } : {}),
    ...(value.laborCents != null ? { laborCents: value.laborCents } : {}),
    ...(value.partsCents != null ? { partsCents: value.partsCents } : {}),
    ...(value.feesCents != null ? { feesCents: value.feesCents } : {}),
    ...(value.discountCents != null ? { discountCents: value.discountCents } : {}),
    ...(value.taxCents != null ? { taxCents: value.taxCents } : {}),
    ...(value.totalCents != null ? { totalCents: value.totalCents } : {}),
  };
  return Object.keys(pricing).length > 0 ? pricing : undefined;
}

function shapeJob(job: DiagnosticsContextJobSource, frontOffice: boolean): ShapedJob {
  const allParts = sortedBounded(
    job.parts ?? [],
    byId((part) => part.partId)
  ).map((part) => ({
    partId: boundedRequiredText(part.partId),
    description: boundedRequiredText(part.description),
    partNumber: boundedText(part.partNumber),
    quantityRequired: part.quantityRequired ?? null,
    quantityReceived: part.quantityReceived ?? null,
    quantityAllocated: part.quantityAllocated ?? null,
    quantityInstalled: part.quantityInstalled ?? null,
    state: boundedRequiredText(part.state),
    notes: boundedText(part.notes),
    ...(frontOffice && part.sellPriceCents != null
      ? { sellPriceCents: part.sellPriceCents }
      : {}),
  }));
  const allChecklist = sortedBounded(
    job.checklist ?? [],
    byId((item) => item.checklistItemId)
  ).map((item) => ({
    checklistItemId: boundedRequiredText(item.checklistItemId),
    title: boundedRequiredText(item.title),
    checked: item.checkedAt !== null,
    checkedAt: item.checkedAt,
  }));
  const allVerification = sortedBounded(
    job.verification ?? [],
    (a, b) =>
      b.recordedAt.localeCompare(a.recordedAt) ||
      a.verificationId.localeCompare(b.verificationId)
  ).map((item) => ({
    verificationId: boundedRequiredText(item.verificationId),
    result: boundedRequiredText(item.result),
    notes: boundedText(item.notes),
    recordedAt: item.recordedAt,
  }));
  const parts = budgetItems(allParts, SECTION_BUDGETS.selectedJobParts);
  const checklist = budgetItems(allChecklist, SECTION_BUDGETS.selectedJobChecklist);
  const verification = budgetItems(
    allVerification,
    SECTION_BUDGETS.selectedJobVerification
  );

  const shaped: ShapedJob = {
    jobId: boundedRequiredText(job.jobId),
    origin: boundedRequiredText(job.origin),
    serviceName: boundedRequiredText(job.serviceName),
    status: boundedRequiredText(job.status),
    workState: boundedText(job.workState),
    notes: boundedText(job.notes),
    completedAt: job.completedAt ?? null,
    parts: parts.items,
    checklist: checklist.items,
    proof: job.proof
      ? {
          required: job.proof.required,
          photoCount: Math.max(0, Math.trunc(job.proof.photoCount)),
          exceptionRecorded: job.proof.exceptionRecorded,
        }
      : null,
    verification: verification.items,
    verificationEvidenceRecorded: verification.items.length > 0,
    truncation: {
      parts: parts.truncation,
      checklist: checklist.truncation,
      verification: verification.truncation,
    },
  };

  if (frontOffice) {
    const pricing = shapePricing(job.prices);
    if (pricing) shaped.pricing = pricing;
    if (job.authorization) {
      shaped.authorization = {
        decision: boundedRequiredText(job.authorization.decision),
        decidedAt: job.authorization.decidedAt,
        ...(boundedText(job.authorization.method)
          ? { method: boundedText(job.authorization.method) }
          : {}),
        ...(boundedText(job.authorization.reason)
          ? { reason: boundedText(job.authorization.reason) }
          : {}),
      };
    }
  }
  return shaped;
}

function sanitizeChecklist(
  value: unknown,
  depth: number,
  work: { remaining: number }
): unknown {
  if (depth > DEEP_MAX_DEPTH) return null;
  if (work.remaining <= 0) return "[CLIPPED_WORK_BUDGET]";
  work.remaining -= 1;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return boundedText(value)?.slice(0, DEEP_TEXT_CHARS) ?? null;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value.slice(0, DEEP_MAX_ITEMS)) {
      if (work.remaining <= 0) {
        result.push("[CLIPPED_WORK_BUDGET]");
        break;
      }
      result.push(sanitizeChecklist(item, depth + 1, work));
    }
    return result;
  }
  if (typeof value !== "object") return null;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)
    .filter(
      (key) =>
        !/(photo|image|signature|signed_?by|initials|token|url|path|customer|contact|address|email|phone|vin|price|cost)/i.test(
          key
        ) && !/name$/i.test(key)
    )
    .sort()
    .slice(0, DEEP_MAX_ITEMS)) {
    if (work.remaining <= 0) {
      result.__truncated = "[CLIPPED_WORK_BUDGET]";
      break;
    }
    result[key.slice(0, 100)] = sanitizeChecklist(
      (value as Record<string, unknown>)[key],
      depth + 1,
      work
    );
  }
  return result;
}

function shapeChecks(
  rows: DiagnosticsCheckSource[] | undefined,
  work: { remaining: number }
): ShapedCheck[] {
  return [...(rows ?? [])]
    .sort(
      (a, b) =>
        b.performedAt.localeCompare(a.performedAt) ||
        a.attemptId.localeCompare(b.attemptId)
    )
    .map((row) => ({
      attemptId: boundedRequiredText(row.attemptId),
      outcome: boundedRequiredText(row.outcome),
      checklist: sanitizeChecklist(row.checklist ?? null, 0, work),
      notes: boundedText(row.notes),
      performedAt: row.performedAt,
    }));
}

export function buildDiagnosticsContextBlock(context: DiagnosticsModelContext): string {
  return buildUntrustedReferenceBlock(
    "current_work_order_context",
    context,
    DIAGNOSTICS_MAX_CONTEXT_BLOCK_CHARS
  );
}

export function hashDiagnosticsContext(context: DiagnosticsModelContext): string {
  return createHash("sha256").update(buildDiagnosticsContextBlock(context)).digest("hex");
}

export function deriveDiagnosticsClaimContext(
  context: DiagnosticsModelContext
): DiagnosticsClaimContext {
  const selected = context.selectedJob;
  const allowedPriceCents = new Set<number>();
  if (selected?.pricing) {
    for (const value of Object.entries(selected.pricing)) {
      if (value[0] !== "currency" && typeof value[1] === "number") {
        allowedPriceCents.add(value[1]);
      }
    }
  }
  for (const part of selected?.parts ?? []) {
    if (typeof part.sellPriceCents === "number") {
      allowedPriceCents.add(part.sellPriceCents);
    }
  }
  const exactModelReference = context.referenceEvidence.exactModelOem;
  const measuredEvidence = [
    context.workOrder.complaint,
    context.workOrder.internalNotes,
    selected?.notes,
    ...context.customerRequestJobs.map((item) => item.notes),
    ...context.recommendations.map((item) => item.notes),
    ...context.inspection.results.map((item) => item.measurement),
    ...(selected?.verification.flatMap((item) => [item.result, item.notes]) ?? []),
    ...context.technicianNotes.map((item) => item.note),
    ...context.checks.quality.map((item) => item.notes),
    ...context.checks.safety.map((item) => item.notes),
    ...context.checks.quality.map((item) => JSON.stringify(item.checklist)),
    ...context.checks.safety.map((item) => JSON.stringify(item.checklist)),
  ].filter((value): value is string => Boolean(value));
  const allowedMeasuredValues = [
    ...new Set(
      measuredEvidence.flatMap((value) => extractDiagnosticsTechnicalValues(value))
    ),
  ].sort();
  const allowedSpecificationValues = exactModelReference
    ? extractDiagnosticsTechnicalValues(exactModelReference)
    : [];
  const includedReferenceEvidence = REFERENCE_NAMES.map(
    (name) => context.referenceEvidence[name]
  ).filter((value): value is string => Boolean(value));
  return {
    hasRecordedCustomerAuthorization:
      selected?.authorization?.decision.toLowerCase() === "approved",
    hasRecordedCompletedWork: Boolean(
      selected &&
      (selected.completedAt ||
        selected.status === "completed" ||
        selected.workState === "completed")
    ),
    hasVerificationEvidence: Boolean(
      selected?.verification.some((item) =>
        /^(?:pass(?:ed)?|success(?:ful)?|resolved|verified)$/i.test(item.result)
      )
    ),
    hasExactModelSource: Boolean(exactModelReference),
    hasCurrentRecallSource: Boolean(context.referenceEvidence.currentRecallLookup),
    hasCurrentOntarioInspectionSource: Boolean(
      context.referenceEvidence.currentOntarioInspection
    ),
    hasSuppliedPrices: allowedPriceCents.size > 0,
    allowedMeasuredValues,
    allowedSpecificationValues,
    allowedTechnicalValues: [
      ...new Set([...allowedMeasuredValues, ...allowedSpecificationValues]),
    ].sort(),
    allowedPriceCents: [...allowedPriceCents].sort((a, b) => a - b),
    availableNamedReferences: REFERENCE_NAMES.filter(
      (name) => context.referenceEvidence[name] !== null
    ),
    hasProvidedReferenceEvidence: includedReferenceEvidence.length > 0,
    includedReferenceEvidence,
  };
}

export function shapeDiagnosticsContext(
  sourceInput: DiagnosticsContextSource,
  options: DiagnosticsContextOptions
): ShapedDiagnosticsContext {
  const source = redactSourceValues(sourceInput, options.redactTerms ?? {});
  if (
    options.serverNowIso != null &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(options.serverNowIso) ||
      !Number.isFinite(Date.parse(options.serverNowIso)))
  ) {
    throw new Error("DIAGNOSTICS_CONTEXT_TIME_INVALID");
  }
  if (!options.workOrderId || source.workOrder.workOrderId !== options.workOrderId) {
    throw new Error("DIAGNOSTICS_CONTEXT_WORK_ORDER_MISMATCH");
  }

  assertSameWorkOrder(source.jobs, options.workOrderId);
  assertSameWorkOrder(source.technicianNotes ?? [], options.workOrderId);
  assertSameWorkOrder(source.recommendations ?? [], options.workOrderId);
  assertSameWorkOrder(source.checks?.quality ?? [], options.workOrderId);
  assertSameWorkOrder(source.checks?.safety ?? [], options.workOrderId);
  if (source.inspection && source.inspection.workOrderId !== options.workOrderId) {
    throw new Error("DIAGNOSTICS_CONTEXT_WORK_ORDER_MISMATCH");
  }

  const selectedJob = options.jobId
    ? source.jobs.find((job) => job.jobId === options.jobId)
    : null;
  if (options.jobId && !selectedJob) {
    throw new Error("DIAGNOSTICS_CONTEXT_JOB_MISMATCH");
  }

  const frontOffice = isFrontOffice(options.mode);
  const allInspectionResults = source.inspection
    ? [...source.inspection.results]
        .sort(
          (a, b) =>
            a.displayOrder - b.displayOrder ||
            a.inspectionResultId.localeCompare(b.inspectionResultId)
        )
        .map((result) => ({
          inspectionResultId: boundedRequiredText(result.inspectionResultId),
          category: boundedRequiredText(result.category),
          itemName: boundedRequiredText(result.itemName),
          displayOrder: result.displayOrder,
          status: boundedText(result.status) ?? "uninspected",
          measurement: boundedText(result.measurement),
          notes: boundedText(result.notes),
        }))
    : [];
  const inspectionResults = budgetItems(
    allInspectionResults,
    SECTION_BUDGETS.inspectionResults
  );

  const serviceValues: Record<string, string | null> = {};
  if (source.serviceInformation) {
    for (const key of SERVICE_INFORMATION_KEYS) {
      serviceValues[key] = boundedText(source.serviceInformation[key]);
    }
  }

  const referenceEvidence = Object.fromEntries(
    REFERENCE_NAMES.map((name) => {
      const value = source.references?.[name];
      const text =
        typeof value === "string"
          ? boundedText(value)
          : value && typeof value === "object"
            ? boundedText(value.text)
            : null;
      return [name, text];
    })
  ) as Record<DiagnosticsReferenceName, string | null>;
  const missingReferences = Object.fromEntries(
    REFERENCE_NAMES.map((name) => [name, referenceEvidence[name] === null])
  ) as Record<DiagnosticsReferenceName, boolean>;

  const scopedJobs = options.jobId
    ? source.jobs.filter((job) => job.jobId === options.jobId)
    : source.jobs;
  const customerRequestJobs = budgetItems(
    [...scopedJobs]
      .filter((job) => job.origin === "customer_request")
      .sort(byId((job) => job.jobId))
      .map((job) => ({
        jobId: boundedRequiredText(job.jobId),
        serviceName: boundedRequiredText(job.serviceName),
        status: boundedRequiredText(job.status),
        workState: boundedText(job.workState),
        notes: boundedText(job.notes),
      })),
    SECTION_BUDGETS.customerRequestJobs
  );

  const scopedNotes = (source.technicianNotes ?? []).filter(
    (note) => !options.jobId || note.jobId === null || note.jobId === options.jobId
  );
  const technicianNotes = budgetItems(
    [...scopedNotes]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          a.technicianNoteId.localeCompare(b.technicianNoteId)
      )
      .map((note) => ({
        technicianNoteId: boundedRequiredText(note.technicianNoteId),
        jobId: boundedText(note.jobId),
        noteType: boundedRequiredText(note.noteType),
        note: boundedRequiredText(note.note),
        createdAt: note.createdAt,
      })),
    SECTION_BUDGETS.technicianNotes
  );

  const severityRank: Record<string, number> = {
    safety_critical: 0,
    immediate_attention: 1,
    future_attention: 2,
  };
  const scopedRecommendations = (source.recommendations ?? []).filter(
    (item) => !options.jobId || !item.jobId || item.jobId === options.jobId
  );
  const recommendations = budgetItems(
    [...scopedRecommendations]
      .sort(
        (a, b) =>
          (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99) ||
          a.recommendationId.localeCompare(b.recommendationId)
      )
      .map((recommendation) => ({
        recommendationId: boundedRequiredText(recommendation.recommendationId),
        jobId: boundedText(recommendation.jobId),
        description: boundedRequiredText(recommendation.description),
        severity: boundedRequiredText(recommendation.severity),
        status: boundedRequiredText(recommendation.status),
        disposition: boundedText(recommendation.disposition),
        notes: boundedText(recommendation.notes),
      })),
    SECTION_BUDGETS.recommendations
  );
  const checklistWork = { remaining: DEEP_GLOBAL_NODE_BUDGET };
  const qualityChecks = budgetItems(
    shapeChecks(source.checks?.quality, checklistWork),
    SECTION_BUDGETS.qualityChecks
  );
  const safetyChecks = budgetItems(
    shapeChecks(source.checks?.safety, checklistWork),
    SECTION_BUDGETS.safetyChecks
  );

  const context = {
    missingReferences,
    mode: options.mode,
    audience: diagnosticsAudienceForMode(options.mode),
    referenceEvidence,
    selectedJob: selectedJob ? shapeJob(selectedJob, frontOffice) : null,
    checks: {
      quality: qualityChecks.items,
      safety: safetyChecks.items,
    },
    contextAsOf: options.serverNowIso ?? null,
    workOrder: {
      workOrderId: boundedRequiredText(source.workOrder.workOrderId),
      identifier: boundedRequiredText(source.workOrder.workOrderNumber),
      status: boundedRequiredText(source.workOrder.status),
      lifecycleState: boundedText(source.workOrder.lifecycleState),
      mileage: {
        value: source.workOrder.mileage ?? null,
        unit: boundedText(source.motorcycle.odometerUnit),
      },
      complaint: boundedText(source.workOrder.complaint),
      internalNotes: boundedText(source.workOrder.internalNotes),
    },
    motorcycle: {
      year: source.motorcycle.year,
      make: boundedRequiredText(source.motorcycle.make),
      model: boundedRequiredText(source.motorcycle.model),
      colour: boundedText(source.motorcycle.colour),
      notes: boundedText(source.motorcycle.notes),
      source: "unverified_app_catalogue_reference",
      verified: false,
    },
    serviceInformation: source.serviceInformation
      ? {
          values: serviceValues,
          source: "unverified_app_catalogue_reference",
          verified: false,
        }
      : null,
    customerRequestJobs: customerRequestJobs.items,
    inspection: {
      available: Boolean(source.inspection),
      completed: Boolean(source.inspection?.completedAt),
      completedAt: source.inspection?.completedAt ?? null,
      results: inspectionResults.items,
    },
    technicianNotes: technicianNotes.items,
    recommendations: recommendations.items,
    truncation: {
      customerRequestJobs: customerRequestJobs.truncation,
      inspectionResults: inspectionResults.truncation,
      technicianNotes: technicianNotes.truncation,
      recommendations: recommendations.truncation,
      qualityChecks: qualityChecks.truncation,
      safetyChecks: safetyChecks.truncation,
    },
  } as ShapedDiagnosticsModelContext;
  const contextBlock = buildDiagnosticsContextBlock(context);
  return {
    context,
    contextBlock,
    contextHash: createHash("sha256").update(contextBlock).digest("hex"),
    claims: deriveDiagnosticsClaimContext(context),
  };
}

export const buildDiagnosticsContext = shapeDiagnosticsContext;
