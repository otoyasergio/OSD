"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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

const PRIMARY_TAB_IDS: WorkOrderTabId[] = [
  "overview",
  "jobs",
  "inspection",
  "parts",
  "photos",
  "notes",
];

const MORE_TAB_IDS: WorkOrderTabId[] = [
  "recommendations",
  "timeline",
  "service-info",
  "contract",
  "messages",
];

export function WorkOrderTabs({
  workOrderId,
  activeTab,
}: {
  workOrderId: string;
  activeTab: WorkOrderTabId;
}) {
  const primary = WORK_ORDER_TABS.filter((tab) => PRIMARY_TAB_IDS.includes(tab.id));
  const more = WORK_ORDER_TABS.filter((tab) => MORE_TAB_IDS.includes(tab.id));
  const moreActive = MORE_TAB_IDS.includes(activeTab);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <nav aria-label="Work order sections" className="tab-bar tab-bar-scroll">
      {primary.map((tab) => {
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
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className={moreActive ? "tab-link tab-link-active" : "tab-link"}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((value) => !value)}
        >
          More{moreActive ? " ·" : ""}
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg"
          >
            {more.map((tab) => {
              const active = tab.id === activeTab;
              return (
                <Link
                  key={tab.id}
                  role="menuitem"
                  href={`/work_orders/${workOrderId}?tab=${tab.id}`}
                  className={[
                    "block px-3 py-2 text-sm",
                    active
                      ? "bg-[var(--surface-muted)] font-semibold text-foreground"
                      : "text-foreground hover:bg-[var(--surface-muted)]",
                  ].join(" ")}
                  onClick={() => setOpen(false)}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
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
