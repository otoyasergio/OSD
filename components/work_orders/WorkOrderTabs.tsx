import Link from "next/link";

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

export function WorkOrderTabs({
  workOrderId,
  activeTab,
}: {
  workOrderId: string;
  activeTab: WorkOrderTabId;
}) {
  return (
    <nav aria-label="Work order sections" className="tab-bar">
      {WORK_ORDER_TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={`/work_orders/${workOrderId}?tab=${tab.id}`}
            className={active ? "tab-link tab-link-active" : "tab-link"}
            aria-current={active ? "page" : undefined}
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
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-desc">Coming in next tasks</p>
    </div>
  );
}
