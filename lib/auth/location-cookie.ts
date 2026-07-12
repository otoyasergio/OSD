export const ACTIVE_LOCATION_COOKIE = "otomoto_active_location_id";

export function parseActiveLocationId(
  cookieHeader: string | undefined
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACTIVE_LOCATION_COOKIE}=`));
  return match ? decodeURIComponent(match.split("=")[1]!) : null;
}
