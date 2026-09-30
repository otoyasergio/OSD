"use client";

import { type ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { TECH_BENCH_DROP_ID } from "@/lib/technician/benchDrag";

export function BenchDropZone({
  disabled,
  benchLabel,
  children,
}: {
  disabled?: boolean;
  /** Bike currently on the bench, if any. */
  benchLabel?: string | null;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: TECH_BENCH_DROP_ID,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        "pit-bench-zone",
        isOver && !disabled ? "pit-bench-zone--over" : "",
        benchLabel ? "pit-bench-zone--occupied" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="tech-workbench-drop"
    >
      {!disabled ? (
        <p className="pit-bench-zone-hint" aria-live="polite">
          {isOver
            ? "Release to pull onto your bench"
            : benchLabel
              ? `${benchLabel} is on your bench — drag another bike here to swap`
              : "Drag a bike from the shop list onto your workbench"}
        </p>
      ) : null}
      {children}
    </div>
  );
}
