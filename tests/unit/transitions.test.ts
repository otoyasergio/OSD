import { describe, it, expect } from "vitest";
import { GALLERY_BOARD_COLUMNS } from "@/lib/status/pipeline";
import {
  allowsShopBoardDrop,
  boardColumnIdForStatus,
  buildShopBoardRowsKey,
  canDragShopBoardCard,
  canDragWorkOrderOnBoard,
  canDropInColumn,
  getTargetStatusForColumn,
  isInsuranceBoardColumn,
  isPickupBoardColumn,
  isQcBoardColumn,
  isStorageBoardColumn,
  overlayShopBoardPendingMoves,
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
    expect(canDropInColumn("admin", "complete", "quality_check")).toBe(true);
    expect(canDropInColumn("admin", "pickup", "quality_check")).toBe(false);
    expect(canDropInColumn("admin", "storage", "quality_check")).toBe(true);
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
    expect(boardColumnIdForStatus("completed", GALLERY_BOARD_COLUMNS)).toBe("complete");
    expect(boardColumnIdForStatus("insurance", GALLERY_BOARD_COLUMNS)).toBe("insurance");
    expect(getTargetStatusForColumn("complete")).toBe("completed");
    expect(canDropInColumn("owner", "complete", "quality_check")).toBe(true);
  });

  it("treats gallery Ready as a pickup drop so inspection/QC/safety gates apply", () => {
    expect(isPickupBoardColumn("pickup")).toBe(true);
    expect(isPickupBoardColumn("gallery_ready")).toBe(true);
    expect(isPickupBoardColumn("gallery_in_bay")).toBe(false);
  });

  it("lets front office drag a finished bike into storage and back out", () => {
    expect(getTargetStatusForColumn("storage")).toBe("in_storage");
    expect(getTargetStatusForColumn("gallery_storage")).toBe("in_storage");
    expect(isStorageBoardColumn("storage")).toBe(true);
    expect(isStorageBoardColumn("gallery_storage")).toBe(true);
    expect(isStorageBoardColumn("pickup")).toBe(false);

    expect(canDropInColumn("service_advisor", "storage", "ready_for_pickup")).toBe(true);
    expect(
      canDropInColumn("service_advisor", "gallery_storage", "ready_for_pickup")
    ).toBe(true);
    expect(canDropInColumn("owner", "pickup", "in_storage")).toBe(true);
    expect(canDropInColumn("technician", "storage", "ready_for_pickup")).toBe(false);
    expect(canDropInColumn("service_advisor", "storage", "completed")).toBe(false);
    expect(canDropInColumn("service_advisor", "storage", "in_storage")).toBe(false);

    expect(canDragWorkOrderOnBoard("service_advisor", "in_storage", false)).toBe(true);
    expect(canDragWorkOrderOnBoard("technician", "in_storage", false)).toBe(false);
    expect(canDragWorkOrderOnBoard("service_advisor", "completed", false)).toBe(false);
  });

  it("lets a service advisor or admin park any active bike in storage", () => {
    for (const role of ["service_advisor", "admin"] as const) {
      for (const status of [
        "open",
        "inspection_in_progress",
        "waiting_for_customer_approval",
        "waiting_for_parts",
        "in_progress",
        "quality_check",
        "safety_check",
        "ready_for_pickup",
        "on_hold",
      ] as const) {
        expect(canDropInColumn(role, "storage", status)).toBe(true);
        expect(canDropInColumn(role, "gallery_storage", status)).toBe(true);
        expect(canDragWorkOrderOnBoard(role, status, false)).toBe(true);
      }
    }

    expect(canDropInColumn("admin", "gallery_in_bay", "open")).toBe(false);
    expect(canDropInColumn("technician", "storage", "in_progress")).toBe(false);
    expect(canDropInColumn("service_advisor", "storage", "completed")).toBe(false);
    expect(canDropInColumn("admin", "storage", "cancelled")).toBe(false);
    expect(canDragWorkOrderOnBoard("admin", "completed", false)).toBe(false);
  });

  it("lets a service advisor or admin park any active bike as insurance", () => {
    expect(getTargetStatusForColumn("insurance")).toBe("insurance");
    expect(isInsuranceBoardColumn("insurance")).toBe(true);
    expect(isInsuranceBoardColumn("storage")).toBe(false);

    for (const role of ["service_advisor", "admin"] as const) {
      expect(canDropInColumn(role, "insurance", "in_progress")).toBe(true);
      expect(canDropInColumn(role, "insurance", "on_hold")).toBe(true);
      expect(canDragWorkOrderOnBoard(role, "insurance", false)).toBe(true);
    }
    expect(canDropInColumn("technician", "insurance", "in_progress")).toBe(false);
    expect(canDropInColumn("service_advisor", "insurance", "insurance")).toBe(false);
    expect(canDropInColumn("service_advisor", "insurance", "completed")).toBe(false);
  });

  it("maps storage onto its own gallery column", () => {
    expect(boardColumnIdForStatus("in_storage", GALLERY_BOARD_COLUMNS)).toBe(
      "gallery_storage"
    );
  });

  it("treats gallery QC as a QC drop so unfinished jobs cannot skip to check", () => {
    expect(isQcBoardColumn("qc")).toBe(true);
    expect(isQcBoardColumn("gallery_qc")).toBe(true);
    expect(isQcBoardColumn("gallery_ready")).toBe(false);
  });

  it("changes the shop board sync key when flags, photo, tech, or customer change", () => {
    const base = {
      work_order_id: "wo-1",
      work_order_number: "3885",
      status: "in_progress" as const,
      flags: ["Incomplete inspection"],
      primary_photo_url: null,
      primary_technician: { first_name: "Stefano", last_name: "Franco" },
      motorcycle: {
        year: 2025,
        make: "HONDA",
        model: "Monkey",
        customer: { first_name: "Dominik", last_name: "Szymanski" },
      },
    };
    const afterInspection = {
      ...base,
      flags: [],
      primary_photo_url: "https://example.com/photo.jpg",
    };
    expect(buildShopBoardRowsKey([base])).not.toBe(
      buildShopBoardRowsKey([afterInspection])
    );
  });

  it("overlays in-flight shop board moves until the server snapshot confirms them", () => {
    const rows = [
      {
        work_order_id: "wo-1",
        work_order_number: "3885",
        status: "open" as const,
        flags: [],
        motorcycle: null,
      },
      {
        work_order_id: "wo-2",
        work_order_number: "3884",
        status: "waiting_for_parts" as const,
        flags: [],
        motorcycle: null,
      },
    ];
    const reconciled = overlayShopBoardPendingMoves(rows, {
      "wo-1": "in_progress",
      "wo-2": "completed",
    });
    expect(reconciled.rows.map((r) => `${r.work_order_id}:${r.status}`)).toEqual([
      "wo-1:in_progress",
      "wo-2:completed",
    ]);
    expect(reconciled.remainingPending).toEqual({
      "wo-1": "in_progress",
      "wo-2": "completed",
    });

    const confirmed = overlayShopBoardPendingMoves(
      [
        { ...rows[0], status: "in_progress" as const },
        { ...rows[1], status: "completed" as const },
      ],
      reconciled.remainingPending
    );
    expect(confirmed.remainingPending).toEqual({});
  });

  it("lets owner and admin move cards forward or back on the shop board, including out of Complete", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(canDragShopBoardCard(role, "completed", false)).toBe(true);
      expect(allowsShopBoardDrop(role, "gallery_qc", "completed")).toBe(true);
      expect(allowsShopBoardDrop(role, "gallery_in_bay", "ready_for_pickup")).toBe(true);
      expect(canDragShopBoardCard(role, "cancelled", false)).toBe(false);
    }
    expect(canDragShopBoardCard("manager", "completed", false)).toBe(false);
    expect(allowsShopBoardDrop("manager", "gallery_qc", "completed")).toBe(false);
  });
});
