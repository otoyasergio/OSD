const SHOP_ZONE = "America/Toronto";

function torontoParts(date: Date): string {
  const bag = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: SHOP_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${bag.year}-${bag.month}-${bag.day}T${bag.hour}:${bag.minute}`;
}

/** `datetime-local` value in America/Toronto for an ISO timestamp. */
export function torontoDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return torontoParts(date);
}

/**
 * Wall-clock time entered at the shop, stored as UTC.
 * `YYYY-MM-DDTHH:mm` is Toronto local, including daylight-saving changes.
 */
export function torontoWallClockToIso(raw: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const wanted = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  for (const offsetHours of [-4, -5]) {
    const instant = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute));
    if (torontoParts(instant) === wanted) return instant.toISOString();
  }
  return null;
}
