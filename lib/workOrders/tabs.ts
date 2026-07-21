export const WORK_ORDER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "jobs", label: "Jobs" },
  { id: "inspection", label: "Inspection" },
  { id: "recommendations", label: "Recommendations" },
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
  "jobs",
  "inspection",
  "parts",
  "photos",
  "notes",
];

export const MORE_TAB_IDS: WorkOrderTabId[] = [
  "recommendations",
  "timeline",
  "service-info",
  "contract",
  "messages",
];
