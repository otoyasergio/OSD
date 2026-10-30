type NamedClient = {
  first_name?: string | null;
  last_name?: string | null;
};

/** First and last name for a board card. Empty names are treated as missing. */
export function clientDisplayName(
  customer: NamedClient | NamedClient[] | null | undefined
): string | null {
  const row = Array.isArray(customer) ? customer[0] : customer;
  if (!row) return null;
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
  return name || null;
}
