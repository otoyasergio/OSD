import { randomBytes } from "node:crypto";

const PASSPORT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Explicit service-fact allowlist for passport publication. Customer identity
 * is resolved separately for leak detection and is never part of the payload.
 */
export const PASSPORT_WORK_ORDER_SELECT = `
  work_order_id,
  customer_id,
  work_order_number,
  status,
  completed_at,
  mileage,
  mileage_unit,
  location:location_id ( name ),
  job (
    job_id,
    service_name_snapshot,
    status,
    job_part_requirement (
      description,
      part_number,
      quantity_installed,
      state
    )
  )
`;

type PassportCustomerContact = {
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
};

export function generatePassportNumber(): string {
  const random = randomBytes(8);
  let suffix = "";
  for (const value of random) {
    suffix += PASSPORT_ALPHABET[value % PASSPORT_ALPHABET.length];
  }
  return `OTO-${suffix}`;
}

export function collectPassportSensitiveValues(
  customers: PassportCustomerContact[]
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const customer of customers) {
    const candidates = [
      `${customer.first_name.trim()} ${customer.last_name.trim()}`.trim(),
      customer.phone?.trim(),
      customer.email?.trim(),
      customer.address?.trim(),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const key = candidate.toLocaleLowerCase("en-CA");
      if (seen.has(key)) continue;
      seen.add(key);
      values.push(candidate);
    }
  }

  return values;
}
