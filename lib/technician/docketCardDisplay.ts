import type { DocketItem } from "@/lib/services/technicianDocket";
import type { PitBoardStamp } from "@/lib/technician/pitBoard";

/** True when this card sits in the Waiting list rather than Work now. */
export function isWaitingStamp(stamp: PitBoardStamp): boolean {
  return stamp === "HOLD" || stamp === "PAUSED";
}

/**
 * Display text for a stamp — internal HOLD/PAUSED vocabulary never reaches
 * the floor; waiting bikes read WAIT with the reason on the card itself.
 */
export function stampDisplayLabel(stamp: PitBoardStamp): string {
  return isWaitingStamp(stamp) ? "WAIT" : stamp;
}

/** Secondary line under the bike — WO · job/service (no client PII). */
export function docketCardJobLine(
  item: Pick<
    DocketItem,
    "subtitle" | "service_label" | "board_stamp" | "park_reason_label"
  >
): string {
  const jobPart =
    isWaitingStamp(item.board_stamp) && item.park_reason_label
      ? item.park_reason_label
      : item.service_label;
  return `${item.subtitle} · ${jobPart}`;
}

export function docketCardToneClass(stamp: PitBoardStamp): string {
  return `docket-card--${stamp.toLowerCase()}`;
}

export function docketCardAccessibleName(item: DocketItem): string {
  return `${item.position}. ${item.motorcycle_label}, ${docketCardJobLine(item)}, ${stampDisplayLabel(item.board_stamp)}`;
}

export function stampClass(stamp: PitBoardStamp): string {
  return `pit-stamp pit-stamp--${stamp.toLowerCase()}`;
}
