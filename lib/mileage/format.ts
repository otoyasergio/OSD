export type MileageUnit = "km" | "mi";

type MileageComparison = {
  currentMileage: number | string | null | undefined;
  currentUnit: MileageUnit;
  previousMileage: number | string | null | undefined;
  previousUnit: MileageUnit;
};

export function normalizeMileageUnit(value: unknown): MileageUnit {
  return value === "mi" ? "mi" : "km";
}

export function formatMileage(
  value: number | string | null | undefined,
  unit: MileageUnit | null | undefined
): string {
  if (value == null || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "—";
  return `${numeric.toLocaleString("en-CA")} ${normalizeMileageUnit(unit)}`;
}

/**
 * Warn when a new odometer reading is lower than the previous reading.
 * Cross-unit comparisons allow a small rounding tolerance after conversion.
 */
export function isMileageLowerThanPrevious({
  currentMileage,
  currentUnit,
  previousMileage,
  previousUnit,
}: MileageComparison): boolean {
  const current = Number(currentMileage);
  const previous = Number(previousMileage);
  if (
    currentMileage == null ||
    currentMileage === "" ||
    previousMileage == null ||
    previousMileage === "" ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    current < 0 ||
    previous < 0
  ) {
    return false;
  }

  if (currentUnit === previousUnit) return current < previous;

  const currentKm = currentUnit === "mi" ? current * 1.609344 : current;
  const previousKm = previousUnit === "mi" ? previous * 1.609344 : previous;
  return currentKm < previousKm - 2;
}
