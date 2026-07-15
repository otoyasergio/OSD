import { normalizeEmailInput } from "@/lib/email/normalize";

export type DuplicateMatchField = "phone" | "email";

export type DuplicateCustomerCandidate = {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
};

export type CustomerDuplicateMatch = DuplicateCustomerCandidate & {
  matched_fields: DuplicateMatchField[];
};

export function normalizePhoneForMatching(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length === 10 ? digits : "";
}

export function buildPhoneLookupVariants(raw: string): string[] {
  const digits = normalizePhoneForMatching(raw);
  if (!digits) return [];

  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  const line = digits.slice(6);
  return [
    digits,
    `1${digits}`,
    `+1${digits}`,
    `+1 ${area} ${exchange} ${line}`,
    `+1 (${area}) ${exchange}-${line}`,
    `(${area}) ${exchange}-${line}`,
    `(${area})${exchange}-${line}`,
    `${area}-${exchange}-${line}`,
    `${area} ${exchange} ${line}`,
    `${area}.${exchange}.${line}`,
  ];
}

export function mergeDuplicateCandidates(args: {
  emailRows: DuplicateCustomerCandidate[];
  phoneRows: DuplicateCustomerCandidate[];
  email: string;
  phone: string;
}): CustomerDuplicateMatch[] {
  const normalizedEmail = normalizeEmailInput(args.email);
  const normalizedPhone = normalizePhoneForMatching(args.phone);
  const matches = new Map<string, CustomerDuplicateMatch>();

  function add(row: DuplicateCustomerCandidate, field: DuplicateMatchField) {
    const existing = matches.get(row.customer_id);
    if (existing) {
      if (!existing.matched_fields.includes(field)) existing.matched_fields.push(field);
      return;
    }
    matches.set(row.customer_id, { ...row, matched_fields: [field] });
  }

  for (const row of args.emailRows) {
    if (normalizedEmail && normalizeEmailInput(row.email) === normalizedEmail) {
      add(row, "email");
    }
  }
  for (const row of args.phoneRows) {
    if (normalizedPhone && normalizePhoneForMatching(row.phone) === normalizedPhone) {
      add(row, "phone");
    }
  }

  return [...matches.values()].sort(
    (a, b) =>
      b.matched_fields.length - a.matched_fields.length ||
      a.last_name.localeCompare(b.last_name) ||
      a.first_name.localeCompare(b.first_name)
  );
}
