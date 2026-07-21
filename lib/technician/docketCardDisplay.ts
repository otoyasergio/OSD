import type { DocketItem } from "@/lib/services/technicianDocket";
import type { PitBoardStamp } from "@/lib/technician/pitBoard";

/** Secondary line under the bike — WO · job/service (no client PII). */
export function docketCardJobLine(
  item: Pick<
    DocketItem,
    "subtitle" | "service_label" | "board_stamp" | "park_reason_label"
  >
): string {
  const jobPart =
    item.board_stamp === "HOLD" && item.park_reason_label
      ? item.park_reason_label
      : item.service_label;
  return `${item.subtitle} · ${jobPart}`;
}

export function docketCardToneClass(stamp: PitBoardStamp): string {
  return `docket-card--${stamp.toLowerCase()}`;
}

export function docketCardAccessibleName(item: DocketItem): string {
  return `${item.position}. ${item.motorcycle_label}, ${docketCardJobLine(item)}, ${item.board_stamp}`;
}

export function stampClass(stamp: PitBoardStamp): string {
  return `pit-stamp pit-stamp--${stamp.toLowerCase()}`;
}
