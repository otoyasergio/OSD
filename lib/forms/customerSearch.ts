import type { Customer } from "@/lib/services/customers";

function matchesNameTokens(customer: Customer, term: string): boolean {
  const tokens = term.trim().toLocaleLowerCase("en-CA").split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;

  const first = customer.first_name.toLocaleLowerCase("en-CA");
  const last = customer.last_name.toLocaleLowerCase("en-CA");
  const full = `${first} ${last}`;
  const reversed = `${last} ${first}`;
  const compact = `${last}, ${first}`;

  if (full.includes(term) || reversed.includes(term) || compact.includes(term)) {
    return true;
  }

  return tokens.every((token) => first.includes(token) || last.includes(token));
}

export function filterKnownCustomerMatches(
  customers: readonly Customer[],
  rawTerm: string
): Customer[] {
  const term = rawTerm.trim().toLocaleLowerCase("en-CA");
  if (!term) return [...customers];

  const digits = rawTerm.replace(/\D/g, "");
  return customers.filter((customer) => {
    const fields = [
      customer.first_name,
      customer.last_name,
      customer.phone ?? "",
      customer.email ?? "",
    ];
    if (fields.some((field) => field.toLocaleLowerCase("en-CA").includes(term))) {
      return true;
    }
    if (matchesNameTokens(customer, term)) {
      return true;
    }
    return (
      digits.length >= 3 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)
    );
  });
}

/** Optimistic dropdown rows while a server search is in flight. */
export function customerPickerInterimResults(
  knownCustomers: readonly Customer[],
  rawTerm: string
): Customer[] {
  return filterKnownCustomerMatches(knownCustomers, rawTerm);
}
