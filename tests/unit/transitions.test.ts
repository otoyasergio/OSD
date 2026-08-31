import { describe, it, expect } from "vitest";
import { GALLERY_BOARD_COLUMNS } from "@/lib/status/pipeline";
import {
  boardColumnIdForStatus,
  canDropInColumn,
  getTargetStatusForColumn,
  isPickupBoardColumn,
  isQcBoardColumn,
  resolveShopBoardDropColumnId,
} from "@/lib/status/transitions";

describe("board transitions", () => {
  it("maps intake column drop to open", () => {
    expect(getTargetStatusForColumn("intake")).toBe("open");
  });

  it("blocks technician from dropping into quality_check", () => {
    expect(canDropInColumn("technician", "qc", "in_progress")).toBe(false);
  });

  it("allows manager to drop in_progress into qc column", () => {
    expect(canDropInColumn("manager", "qc", "in_progress")).toBe(true);
  });

  it("maps complete column to completed and gates by front office", () => {
    expect(getTargetStatusForColumn("complete")).toBe("completed");
    expect(canDropInColumn("service_advisor", "complete", "ready_for_pickup")).toBe(true);
    expect(canDropInColumn("technician", "complete", "ready_for_pickup")).toBe(false);
    expect(canDropInColumn("service_advisor", "complete", "completed")).toBe(false);
  });

  it("resolves a drop onto another card to that card's column", () => {
    expect(
      resolveShopBoardDropColumnId({
        overId: "gallery_qc",
        columnIds: new Set(["gallery_intake", "gallery_qc"]),
        columnIdForWorkOrder: () => null,
      })
    ).toBe("gallery_qc");

    expect(
      resolveShopBoardDropColumnId({
        overId: "wo-1",
        columnIds: new Set(["gallery_intake", "gallery_in_bay"]),
        columnIdForWorkOrder: (id) => (id === "wo-1" ? "gallery_in_bay" : null),
      })
    ).toBe("gallery_in_bay");
  });

  it("maps gallery statuses to the column the card currently sits in", () => {
    expect(boardColumnIdForStatus("waiting_for_parts", GALLERY_BOARD_COLUMNS)).toBe(
      "gallery_in_bay"
    );
    expect(boardColumnIdForStatus("open", GALLERY_BOARD_COLUMNS)).toBe("gallery_intake");
    expect(boardColumnIdForStatus("ready_for_pickup", GALLERY_BOARD_COLUMNS)).toBe(
      "gallery_ready"
    );
  });

  it("treats gallery Ready as a pickup drop so inspection/QC/safety gates apply", () => {
    expect(isPickupBoardColumn("pickup")).toBe(true);
    expect(isPickupBoardColumn("gallery_ready")).toBe(true);
    expect(isPickupBoardColumn("gallery_in_bay")).toBe(false);
  });

  it("treats gallery QC as a QC drop so unfinished jobs cannot skip to check", () => {
    expect(isQcBoardColumn("qc")).toBe(true);
    expect(isQcBoardColumn("gallery_qc")).toBe(true);
    expect(isQcBoardColumn("gallery_ready")).toBe(false);
  });
});
