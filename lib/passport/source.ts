import { randomBytes } from "node:crypto";

const PASSPORT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

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
    const firstName = customer.first_name.trim();
    const lastName = customer.last_name.trim();
    const candidates = [
      `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
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
