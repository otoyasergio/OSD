"use client";

import { memo, useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";

export const DraggableWorkOrderCard = memo(function DraggableWorkOrderCard({
  workOrder,
  compact = false,
  disabled = false,
}: {
  workOrder: WorkOrderCardData;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: workOrder.work_order_id,
    data: { workOrder },
    disabled,
  });
  const didDragRef = useRef(false);
  useEffect(() => {
    if (isDragging) didDragRef.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      style={isDragging ? { opacity: 0 } : undefined}
      className={
        disabled ? "wo-card-drag-wrap" : "wo-card-drag-wrap wo-card-drag-wrap--draggable"
      }
      {...listeners}
      {...attributes}
      aria-roledescription={disabled ? undefined : "draggable work order"}
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (!didDragRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        didDragRef.current = false;
      }}
    >
      <WorkOrderCard workOrder={workOrder} compact={compact} />
    </div>
  );
});
