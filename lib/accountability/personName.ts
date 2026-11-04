type NameRow = { first_name?: string | null; last_name?: string | null };

/** "First Last" for an embedded app_user row, or null when there is no name. */
export function personName(row: NameRow | NameRow[] | null | undefined): string | null {
  const person = Array.isArray(row) ? (row[0] ?? null) : row;
  if (!person?.first_name && !person?.last_name) return null;
  return `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
}
