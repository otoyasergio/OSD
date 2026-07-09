import Link from "next/link";

export const WORK_ORDER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "jobs", label: "Jobs" },
  { id: "inspection", label: "Inspection" },
  { id: "recommendations", label: "Recommendations" },
  { id: "parts", label: "Parts" },
  { id: "photos", label: "Photos" },
  { id: "notes", label: "Notes" },
  { id: "timeline", label: "Timeline" },
  { id: "service-info", label: "Service Info" },
] as const;

export type WorkOrderTabId = (typeof WORK_ORDER_TABS)[number]["id"];

export function WorkOrderTabs({
  workOrderId,
  activeTab,
}: {
  workOrderId: string;
  activeTab: WorkOrderTabId;
}) {
  return (
    <nav
      aria-label="Work order sections"
      className="flex flex-wrap gap-1 border-b border-zinc-200"
    >
      {WORK_ORDER_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={`/work_orders/${workOrderId}?tab=${tab.id}`}
            className={`inline-flex min-h-11 items-center px-3 py-2 text-sm font-medium ${
              active
                ? "border-b-2 border-zinc-900 text-zinc-900"
                : "border-b-2 border-transparent text-zinc-600"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ComingSoonPanel({ title }: { title: string }) {
  return (
    <div className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-zinc-600">
      {title} — coming in next tasks
    </div>
  );
}
