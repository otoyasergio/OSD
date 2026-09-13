export const WORK_ORDER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "estimate", label: "Estimate & Jobs" },
  { id: "inspection", label: "Inspection" },
  { id: "parts", label: "Parts" },
  { id: "photos", label: "Photos" },
  { id: "notes", label: "Notes" },
  { id: "timeline", label: "Activity" },
  { id: "service-info", label: "Service Info" },
  { id: "contract", label: "Contract" },
  { id: "messages", label: "Messages" },
] as const;

export type WorkOrderTabId = (typeof WORK_ORDER_TABS)[number]["id"];

export const PRIMARY_TAB_IDS: WorkOrderTabId[] = [
  "overview",
  "estimate",
  "inspection",
  "parts",
  "photos",
  "notes",
];

export const MORE_TAB_IDS: WorkOrderTabId[] = [
  "timeline",
  "service-info",
  "contract",
  "messages",
];

/**
 * The old Jobs and Recommendations tabs merged into "Estimate & Jobs".
 * Bookmarks and deep links using the retired query values keep working.
 */
export const LEGACY_TAB_ALIASES: Record<string, WorkOrderTabId> = {
  jobs: "estimate",
  recommendations: "estimate",
};

export function resolveWorkOrderTabId(value: string | null | undefined): WorkOrderTabId {
  if (value && WORK_ORDER_TABS.some((tab) => tab.id === value)) {
    return value as WorkOrderTabId;
  }
  if (value && value in LEGACY_TAB_ALIASES) {
    return LEGACY_TAB_ALIASES[value];
  }
  return "overview";
}
