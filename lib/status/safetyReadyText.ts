/** Pedram's mobile. Staff alert only — not a shop customer. */
export const PEDRAM_SAFETY_PHONE = "+14168415474";

export function safetyReadyMessage(bike: {
  make?: string | null;
  year?: number | string | null;
  model?: string | null;
}): string {
  const make = bike.make?.trim() || "Motorcycle";
  const year =
    bike.year == null || String(bike.year).trim() === "" ? "" : String(bike.year).trim();
  const model = bike.model?.trim() ?? "";
  const label = [make, year, model].filter(Boolean).join(" ");
  return `${label} is ready for safety`;
}

/** One text each time a visit moves into the safety column. */
export function entersSafetyColumn(previousStatus: string, nextStatus: string): boolean {
  return nextStatus === "safety_check" && previousStatus !== "safety_check";
}
