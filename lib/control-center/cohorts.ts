import type { ControlCenterBike } from "@/lib/services/controlCenter";

export const CONTROL_CENTER_COHORTS = {
  completed_today: {
    key: "completed_today",
    title: "Completed today",
    description: "Work orders marked completed since midnight.",
  },
  in_shop: {
    key: "in_shop",
    title: "In shop",
    description: "Active bikes currently in the shop.",
  },
  at_risk: {
    key: "at_risk",
    title: "At risk",
    description: "Overdue, safety-critical, or idle for 3+ days.",
  },
  in_bay: {
    key: "in_bay",
    title: "In bay",
    description: "Bikes with work in progress.",
  },
  unassigned: {
    key: "unassigned",
    title: "Unassigned",
    description: "Active bikes waiting for a technician.",
  },
  waiting_approval: {
    key: "waiting_approval",
    title: "Waiting approval",
    description: "Bikes waiting for customer approval.",
  },
  ready_for_pickup: {
    key: "ready_for_pickup",
    title: "Ready for pickup",
    description: "Bikes ready for customer pickup.",
  },
} as const;

export type ControlCenterCohortKey = keyof typeof CONTROL_CENTER_COHORTS;

export function parseControlCenterCohort(
  raw: string | undefined | null
): ControlCenterCohortKey | null {
  if (!raw) return null;
  if (raw in CONTROL_CENTER_COHORTS) {
    return raw as ControlCenterCohortKey;
  }
  return null;
}

export function controlCenterCohortHref(cohort: ControlCenterCohortKey): string {
  return `/control-center?cohort=${cohort}`;
}

export function flattenControlCenterBikes(input: {
  pool: ControlCenterBike[];
  techs: Array<{ assigned_bikes: ControlCenterBike[] }>;
}): ControlCenterBike[] {
  const map = new Map<string, ControlCenterBike>();
  for (const bike of input.pool) {
    map.set(bike.work_order_id, bike);
  }
  for (const tech of input.techs) {
    for (const bike of tech.assigned_bikes) {
      map.set(bike.work_order_id, bike);
    }
  }
  return [...map.values()];
}

export function filterControlCenterCohort(
  bikes: ControlCenterBike[],
  cohort: ControlCenterCohortKey
): ControlCenterBike[] {
  switch (cohort) {
    case "completed_today":
      // Completed bikes are not in the active CC board payload.
      return [];
    case "in_shop":
      return bikes;
    case "at_risk":
      return bikes.filter((bike) => bike.at_risk);
    case "in_bay":
      return bikes.filter((bike) => bike.status === "in_progress");
    case "unassigned":
      return bikes.filter((bike) => !bike.technician_id);
    case "waiting_approval":
      return bikes.filter((bike) => bike.status === "waiting_for_customer_approval");
    case "ready_for_pickup":
      return bikes.filter((bike) => bike.status === "ready_for_pickup");
    default: {
      const _exhaustive: never = cohort;
      return _exhaustive;
    }
  }
}
