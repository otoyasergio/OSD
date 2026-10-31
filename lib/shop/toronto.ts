/**
 * Toronto shop facts. The location table stores a code only, so customer
 * messages read the address and hours from here.
 */
export const TORONTO_SHOP = {
  locationCode: "TOR",
  tradeName: "Toronto Moto",
  legalName: "OTOMOTO TORONTO MOTO INC.",
  streetAddress: "99 River Street",
  fullAddress: "99 River Street, Toronto, ON M5A 3P4",
  phoneDisplay: "647-424-1088",
  phoneE164: "+16474241088",
  hours: "Mon–Fri 12:00–19:00, Sat 10:00–16:00",
  sunday: "Sun closed",
} as const;
