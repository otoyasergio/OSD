import type { FloorQueueItem, TechnicianFloorOs } from "@/lib/services/technicianFloor";

export function chooseNextFloorItem(
  floor: Pick<TechnicianFloorOs, "priority" | "needsQc" | "readyToPull">,
  completedWorkOrderId: string
): FloorQueueItem | null {
  return (
    floor.priority.find((item) => item.work_order_id === completedWorkOrderId) ??
    floor.priority.find((item) => item.is_active) ??
    floor.priority[0] ??
    floor.needsQc[0] ??
    floor.readyToPull[0] ??
    null
  );
}
