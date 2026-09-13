"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { DocketItem } from "@/lib/services/technicianDocket";
import { canDragDocketItemToBench, docketDragId } from "@/lib/technician/benchDrag";

export function DraggableDocketCard({
  item,
  dragEnabled,
  isDragging,
  children,
}: {
  item: DocketItem;
  dragEnabled: boolean;
  isDragging?: boolean;
  children: ReactNode;
}) {
  const draggable = dragEnabled && canDragDocketItemToBench(item);
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging: localDragging,
  } = useDraggable({
    id: docketDragId(item),
    data: { item },
    disabled: !draggable,
  });
  const didDragRef = useRef(false);

  useEffect(() => {
    if (localDragging || isDragging) didDragRef.current = true;
  }, [localDragging, isDragging]);

  if (!draggable) {
    return <>{children}</>;
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        "pit-queue-drag-wrap",
        localDragging || isDragging ? "pit-queue-drag-wrap--dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...listeners}
      {...attributes}
      aria-roledescription="draggable shop bike"
      onClickCapture={(event) => {
        if (!didDragRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        didDragRef.current = false;
      }}
    >
      {children}
    </div>
  );
}
