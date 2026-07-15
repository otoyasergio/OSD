import type { Customer } from "@/lib/services/customers";

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
    return (
      digits.length >= 3 && (customer.phone ?? "").replace(/\D/g, "").includes(digits)
    );
  });
}
