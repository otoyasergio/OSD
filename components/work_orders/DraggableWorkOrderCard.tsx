"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  WorkOrderCard,
  type WorkOrderCardData,
} from "@/components/work_orders/WorkOrderCard";

export function DraggableWorkOrderCard({
  workOrder,
  compact = false,
  disabled = false,
}: {
  workOrder: WorkOrderCardData;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: workOrder.work_order_id,
      data: { workOrder },
      disabled,
    });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.55 : 1,
        zIndex: isDragging ? 20 : undefined,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        disabled
          ? "wo-card-drag-wrap"
          : "wo-card-drag-wrap wo-card-drag-wrap--draggable"
      }
      {...listeners}
      {...attributes}
      aria-roledescription={disabled ? undefined : "draggable work order"}
    >
      <WorkOrderCard workOrder={workOrder} compact={compact} />
    </div>
  );
}
