import {
  passportSnapshotSchema,
  type PassportSnapshotPayload,
} from "@/lib/passport/schema";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_CANDIDATE_PATTERN = /\+?\d[\d().\s-]{8,}\d/g;
const PRICE_PATTERN =
  /(?:[$€£]\s*\d|\b(?:CAD|USD)\s*\$?\s*\d|\b\d+(?:\.\d{2})?\s*(?:dollars?|CAD|USD)\b)/i;

type StringValue = {
  path: string;
  value: string;
};

function collectStrings(value: unknown, path = ""): StringValue[] {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, item]) =>
    collectStrings(item, path ? `${path}.${key}` : key)
  );
}

function containsPhoneNumber(value: string): boolean {
  const candidates = value.match(PHONE_CANDIDATE_PATTERN) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  });
}

function isServiceFacingFreeText(path: string): boolean {
  return (
    path.includes(".completed_services[") ||
    path.includes(".installed_parts[") ||
    path.startsWith("limitations[")
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsSensitiveValue(value: string, sensitive: string): boolean {
  if (/^[\p{L}\p{M}'’-]+$/u.test(sensitive)) {
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(sensitive)}(?=$|[^\\p{L}\\p{N}])`,
      "iu"
    ).test(value);
  }
  return value.includes(sensitive);
}

export class PassportPrivacyError extends Error {
  readonly risks: string[];

  constructor(
    code: "PASSPORT_PAYLOAD_INVALID" | "PASSPORT_DISCLOSURE_RISK",
    risks: string[]
  ) {
    super(code);
    this.name = "PassportPrivacyError";
    this.risks = risks;
  }
}

export function findPassportDisclosureRisks(
  payload: PassportSnapshotPayload,
  sensitiveValues: string[] = []
): string[] {
  const strings = collectStrings(payload);
  const normalizedSensitiveValues = sensitiveValues
    .map((value) => value.trim().toLocaleLowerCase("en-CA"))
    .filter(Boolean);
  const risks = new Set<string>();

  for (const item of strings) {
    const normalized = item.value.toLocaleLowerCase("en-CA");

    if (
      normalizedSensitiveValues.some((sensitive) =>
        containsSensitiveValue(normalized, sensitive)
      )
    ) {
      risks.add(`${item.path}:sensitive_value`);
    }

    if (!isServiceFacingFreeText(item.path)) continue;
    if (EMAIL_PATTERN.test(item.value)) risks.add(`${item.path}:email`);
    if (containsPhoneNumber(item.value)) risks.add(`${item.path}:phone`);
    if (PRICE_PATTERN.test(item.value)) risks.add(`${item.path}:price`);
  }

  return [...risks].sort();
}

export function validatePassportPayload(
  input: unknown,
  sensitiveValues: string[] = []
): PassportSnapshotPayload {
  const parsed = passportSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new PassportPrivacyError("PASSPORT_PAYLOAD_INVALID", [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ]);
  }

  const risks = findPassportDisclosureRisks(parsed.data, sensitiveValues);
  if (risks.length > 0) {
    throw new PassportPrivacyError("PASSPORT_DISCLOSURE_RISK", risks);
  }

  return parsed.data;
}
