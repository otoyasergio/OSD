import { createHash } from "node:crypto";
import type { DiagnosticsClaimContext } from "@/lib/diagnostics/outputPolicy";
import type { DiagnosticsMode } from "@/lib/diagnostics/responseSchema";

export const DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS = 2_000;
export const DIAGNOSTICS_MAX_COLLECTION_ITEMS = 100;

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
  references?: Partial<Record<DiagnosticsReferenceName, boolean>>;
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
  includeFullVin?: boolean;
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
  pricing?: NonNullable<DiagnosticsContextJobSource["prices"]>;
  authorization?: NonNullable<DiagnosticsContextJobSource["authorization"]>;
};

export type DiagnosticsModelContext = {
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
    vin?: string;
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
};

type ShapedCheck = {
  attemptId: string;
  outcome: string;
  checklist: unknown;
  notes: string | null;
  performedAt: string;
};

export type ShapedDiagnosticsContext = {
  context: DiagnosticsModelContext;
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
  return normalized.slice(0, DIAGNOSTICS_MAX_CONTEXT_TEXT_CHARS);
}

function boundedRequiredText(value: string): string {
  return boundedText(value) ?? "";
}

function sortedBounded<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...values].sort(compare).slice(0, DIAGNOSTICS_MAX_COLLECTION_ITEMS);
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
  const parts = sortedBounded(
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
  const checklist = sortedBounded(
    job.checklist ?? [],
    byId((item) => item.checklistItemId)
  ).map((item) => ({
    checklistItemId: boundedRequiredText(item.checklistItemId),
    title: boundedRequiredText(item.title),
    checked: item.checkedAt !== null,
    checkedAt: item.checkedAt,
  }));
  const verification = sortedBounded(
    job.verification ?? [],
    (a, b) =>
      a.recordedAt.localeCompare(b.recordedAt) ||
      a.verificationId.localeCompare(b.verificationId)
  ).map((item) => ({
    verificationId: boundedRequiredText(item.verificationId),
    result: boundedRequiredText(item.result),
    notes: boundedText(item.notes),
    recordedAt: item.recordedAt,
  }));

  const shaped: ShapedJob = {
    jobId: boundedRequiredText(job.jobId),
    origin: boundedRequiredText(job.origin),
    serviceName: boundedRequiredText(job.serviceName),
    status: boundedRequiredText(job.status),
    workState: boundedText(job.workState),
    notes: boundedText(job.notes),
    completedAt: job.completedAt ?? null,
    parts,
    checklist,
    proof: job.proof
      ? {
          required: job.proof.required,
          photoCount: Math.max(0, Math.trunc(job.proof.photoCount)),
          exceptionRecorded: job.proof.exceptionRecorded,
        }
      : null,
    verification,
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

function sanitizeChecklist(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return boundedText(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, DIAGNOSTICS_MAX_COLLECTION_ITEMS)
      .map((item) => sanitizeChecklist(item, depth + 1));
  }
  if (typeof value !== "object") return null;

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)
    .filter(
      (key) => !/(signature|customer|contact|address|url|path|vin|price|cost)/i.test(key)
    )
    .sort()
    .slice(0, DIAGNOSTICS_MAX_COLLECTION_ITEMS)) {
    result[key.slice(0, 100)] = sanitizeChecklist(
      (value as Record<string, unknown>)[key],
      depth + 1
    );
  }
  return result;
}

function shapeChecks(rows: DiagnosticsCheckSource[] | undefined): ShapedCheck[] {
  return sortedBounded(
    rows ?? [],
    (a, b) =>
      a.performedAt.localeCompare(b.performedAt) || a.attemptId.localeCompare(b.attemptId)
  ).map((row) => ({
    attemptId: boundedRequiredText(row.attemptId),
    outcome: boundedRequiredText(row.outcome),
    checklist: sanitizeChecklist(row.checklist ?? null),
    notes: boundedText(row.notes),
    performedAt: row.performedAt,
  }));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(",")}}`;
}

export function hashDiagnosticsContext(context: DiagnosticsModelContext): string {
  return createHash("sha256").update(stableSerialize(context)).digest("hex");
}

export function deriveDiagnosticsClaimContext(
  context: DiagnosticsModelContext
): DiagnosticsClaimContext {
  const selected = context.selectedJob;
  return {
    hasRecordedCustomerAuthorization: Boolean(selected?.authorization),
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
    hasExactModelSource: !context.missingReferences.exactModelOem,
    hasCurrentRecallSource: !context.missingReferences.currentRecallLookup,
    hasCurrentOntarioInspectionSource:
      !context.missingReferences.currentOntarioInspection,
    hasSuppliedPrices: Boolean(selected?.pricing),
  };
}

export function shapeDiagnosticsContext(
  source: DiagnosticsContextSource,
  options: DiagnosticsContextOptions
): ShapedDiagnosticsContext {
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
  const inspectionResults = source.inspection
    ? sortedBounded(
        source.inspection.results,
        (a, b) =>
          a.displayOrder - b.displayOrder ||
          a.inspectionResultId.localeCompare(b.inspectionResultId)
      ).map((result) => ({
        inspectionResultId: boundedRequiredText(result.inspectionResultId),
        category: boundedRequiredText(result.category),
        itemName: boundedRequiredText(result.itemName),
        displayOrder: result.displayOrder,
        status: boundedText(result.status) ?? "uninspected",
        measurement: boundedText(result.measurement),
        notes: boundedText(result.notes),
      }))
    : [];

  const serviceValues: Record<string, string | null> = {};
  if (source.serviceInformation) {
    for (const key of SERVICE_INFORMATION_KEYS) {
      serviceValues[key] = boundedText(source.serviceInformation[key]);
    }
  }

  const missingReferences = Object.fromEntries(
    REFERENCE_NAMES.map((name) => [name, source.references?.[name] !== true])
  ) as Record<DiagnosticsReferenceName, boolean>;

  const context: DiagnosticsModelContext = {
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
      ...(options.includeFullVin && frontOffice && boundedText(source.motorcycle.vin)
        ? { vin: boundedText(source.motorcycle.vin)! }
        : {}),
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
    customerRequestJobs: sortedBounded(
      source.jobs.filter((job) => job.origin === "customer_request"),
      byId((job) => job.jobId)
    ).map((job) => ({
      jobId: boundedRequiredText(job.jobId),
      serviceName: boundedRequiredText(job.serviceName),
      status: boundedRequiredText(job.status),
      workState: boundedText(job.workState),
      notes: boundedText(job.notes),
    })),
    selectedJob: selectedJob ? shapeJob(selectedJob, frontOffice) : null,
    inspection: {
      available: Boolean(source.inspection),
      completed: Boolean(source.inspection?.completedAt),
      completedAt: source.inspection?.completedAt ?? null,
      results: inspectionResults,
    },
    technicianNotes: sortedBounded(
      source.technicianNotes ?? [],
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.technicianNoteId.localeCompare(b.technicianNoteId)
    ).map((note) => ({
      technicianNoteId: boundedRequiredText(note.technicianNoteId),
      jobId: boundedText(note.jobId),
      noteType: boundedRequiredText(note.noteType),
      note: boundedRequiredText(note.note),
      createdAt: note.createdAt,
    })),
    recommendations: sortedBounded(
      source.recommendations ?? [],
      byId((recommendation) => recommendation.recommendationId)
    ).map((recommendation) => ({
      recommendationId: boundedRequiredText(recommendation.recommendationId),
      jobId: boundedText(recommendation.jobId),
      description: boundedRequiredText(recommendation.description),
      severity: boundedRequiredText(recommendation.severity),
      status: boundedRequiredText(recommendation.status),
      disposition: boundedText(recommendation.disposition),
      notes: boundedText(recommendation.notes),
    })),
    checks: {
      quality: shapeChecks(source.checks?.quality),
      safety: shapeChecks(source.checks?.safety),
    },
    missingReferences,
  };

  return {
    context,
    contextHash: hashDiagnosticsContext(context),
    claims: deriveDiagnosticsClaimContext(context),
  };
}

export const buildDiagnosticsContext = shapeDiagnosticsContext;
