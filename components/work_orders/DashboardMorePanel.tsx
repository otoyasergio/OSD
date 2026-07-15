"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";

export function DashboardMorePanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="dashboard-more">
      <button
        type="button"
        className="dashboard-more-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={16} strokeWidth={2.25} aria-hidden />
        {open ? "Hide filters" : "More"}
      </button>
      {open ? <div className="dashboard-more-panel">{children}</div> : null}
    </div>
  );
}
