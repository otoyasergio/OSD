import type { DocketItem } from "@/lib/services/technicianDocket";

export const TECH_BENCH_DROP_ID = "tech-workbench";

export function docketDragId(item: DocketItem): string {
  return item.job_id ? `job:${item.job_id}` : item.key;
}

export function parseDocketDragId(id: string): { jobId: string | null; key: string } {
  if (id.startsWith("job:")) {
    return { jobId: id.slice(4), key: id };
  }
  return { jobId: null, key: id };
}

/** Bikes the tech can drag onto their bench (assigned jobs only). */
export function canDragDocketItemToBench(item: DocketItem): boolean {
  if (!item.job_id) return false;
  if (item.board_status === "bench" || item.board_status === "done") return false;
  if (item.board_status === "check" || item.board_status === "safety") return false;
  if (item.awaiting_customer) return false;
  return (
    item.board_status === "offered" ||
    item.board_status === "next" ||
    item.board_status === "waiting"
  );
}

export type BenchDropAction = "pull" | "resume";

export function benchDropActionForItem(item: DocketItem): BenchDropAction | null {
  if (!canDragDocketItemToBench(item)) return null;
  if (item.board_status === "waiting") return "resume";
  return "pull";
}

export function findDocketItemByDragId(
  items: readonly DocketItem[],
  dragId: string
): DocketItem | null {
  const parsed = parseDocketDragId(dragId);
  if (parsed.jobId) {
    return items.find((item) => item.job_id === parsed.jobId) ?? null;
  }
  return items.find((item) => item.key === parsed.key) ?? null;
}
