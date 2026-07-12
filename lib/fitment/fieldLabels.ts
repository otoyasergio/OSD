/** Human labels for fitment part/spec columns. */
export const FITMENT_FIELD_LABELS: Record<string, string> = {
  frontTireSize: "Front tire",
  rearTireSize: "Rear tire",
  chain: "Chain",
  frontSprocket: "Front sprocket",
  rearSprocket: "Rear sprocket",
  battery: "Battery",
  ngkPlug: "NGK plug",
  lithiumBattery: "Lithium battery",
  oilFilterKN: "Oil filter (KN)",
  oilFilterHF: "Oil filter (HiFlo)",
  airFilterKN: "Air filter (KN)",
  airFilterHFA: "Air filter (HFA)",
  recommendedOil: "Recommended oil",
  forkSealKit: "Fork seal kit",
  brakePadFront: "Front brake pad",
  brakePadRear: "Rear brake pad",
  frontBrakePad: "Front brake pad",
  rearBrakePad: "Rear brake pad",
  rectifierRegulator: "Rectifier / regulator",
  rectifier: "Rectifier",
  regulator: "Regulator",
};

export function fitmentFieldLabel(field: string): string {
  return (
    FITMENT_FIELD_LABELS[field] ??
    field
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (s) => s.toUpperCase())
      .trim()
  );
}

export const FITMENT_SPEC_FIELDS = new Set([
  "frontTireSize",
  "rearTireSize",
  "chain",
  "frontSprocket",
  "rearSprocket",
  "battery",
  "ngkPlug",
  "lithiumBattery",
  "recommendedOil",
]);
