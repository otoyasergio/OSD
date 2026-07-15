export type TechAvailability = "available" | "busy" | "off";

export function deriveTechAvailability(input: {
  clockedIn: boolean;
  activeAssignedJobCount: number;
}): TechAvailability {
  if (!input.clockedIn) return "off";
  if (input.activeAssignedJobCount > 0) return "busy";
  return "available";
}
