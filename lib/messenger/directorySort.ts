export type DirectoryStaffLike = {
  user_id: string;
  last_name: string;
  first_name: string;
  location_ids: string[];
};

/** Active-location staff first (alphabetical), then everyone else (alphabetical). */
export function sortDirectory<T extends DirectoryStaffLike>(
  staff: T[],
  activeLocationId: string | null
): T[] {
  const byName = (a: T, b: T) =>
    a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
  const atLocation = staff.filter(
    (s) => activeLocationId != null && s.location_ids.includes(activeLocationId)
  );
  const atLocationIds = new Set(atLocation.map((s) => s.user_id));
  const rest = staff.filter((s) => !atLocationIds.has(s.user_id));
  return [...atLocation.sort(byName), ...rest.sort(byName)];
}
