import { describe, expect, it } from "vitest";
import {
  buildDashboardBikeListItem,
  GALLERY_BOARD_COLUMNS,
  getGalleryStageForStatus,
  getPipelineStageIndex,
  getWorkOrderNextAction,
  VISIT_PIPELINE_STAGES,
} from "@/lib/status/pipeline";
import type { WorkOrderStatus } from "@/lib/database/types";

describe("getPipelineStageIndex", () => {
  it("maps operational statuses to pipeline stages", () => {
    expect(getPipelineStageIndex("draft")).toBe(0);
    expect(getPipelineStageIndex("inspection_in_progress")).toBe(1);
    expect(getPipelineStageIndex("waiting_for_customer_approval")).toBe(2);
    expect(getPipelineStageIndex("in_progress")).toBe(4);
    expect(getPipelineStageIndex("quality_check")).toBe(5);
    expect(getPipelineStageIndex("safety_check")).toBe(6);
    expect(getPipelineStageIndex("ready_for_pickup")).toBe(7);
    expect(getPipelineStageIndex("in_storage")).toBe(8);
  });

  it("returns -1 for cancelled and -2 for on hold", () => {
    expect(getPipelineStageIndex("cancelled")).toBe(-1);
    expect(getPipelineStageIndex("on_hold")).toBe(-2);
  });
});

describe("getWorkOrderNextAction", () => {
  it("prioritizes blocking flags over status", () => {
    expect(getWorkOrderNextAction("in_progress", ["Incomplete inspection"])).toContain(
      "inspection"
    );
    expect(getWorkOrderNextAction("ready_for_technician", ["Needs approval"])).toContain(
      "approval"
    );
    expect(getWorkOrderNextAction("open", ["Contract unsigned"])).toBe(
      "Start inspection"
    );
  });

  it("returns status-specific hints when no flags", () => {
    expect(getWorkOrderNextAction("quality_check", [])).toMatch(/final inspection/i);
    expect(getWorkOrderNextAction("safety_check", [])).toMatch(/safety/i);
    expect(getWorkOrderNextAction("waiting_for_parts", [])).toContain("parts");
    expect(getWorkOrderNextAction("open", [])).toBe("Start inspection");
    expect(getWorkOrderNextAction("open", ["No intake photos"])).toBe(
      "Capture intake photos"
    );
  });
});

describe("VISIT_PIPELINE_STAGES", () => {
  it("covers the main operational flow", () => {
    expect(VISIT_PIPELINE_STAGES).toHaveLength(9);
  });
});

describe("GALLERY_BOARD_COLUMNS", () => {
  it("uses Track Day stages covering operational statuses", () => {
    expect(GALLERY_BOARD_COLUMNS).toHaveLength(7);
    expect(
      GALLERY_BOARD_COLUMNS.find((column) => column.id === "gallery_ready")?.statuses
    ).toEqual(["ready_for_pickup"]);
    expect(
      GALLERY_BOARD_COLUMNS.find((column) => column.id === "complete")?.statuses
    ).toEqual(["completed"]);
    const covered = new Set(
      GALLERY_BOARD_COLUMNS.flatMap((column) => [...column.statuses])
    );
    const required: WorkOrderStatus[] = [
      "draft",
      "open",
      "inspection_in_progress",
      "waiting_for_customer_approval",
      "waiting_for_parts",
      "ready_for_technician",
      "in_progress",
      "on_hold",
      "quality_check",
      "safety_check",
      "ready_for_pickup",
      "in_storage",
      "completed",
    ];
    for (const status of required) {
      expect(covered.has(status)).toBe(true);
    }
  });

  it("maps statuses to gallery stage labels", () => {
    expect(getGalleryStageForStatus("in_progress")).toEqual({
      label: "In bay",
      tone: "orange",
    });
    expect(getGalleryStageForStatus("quality_check").label).toBe("Final inspection");
    expect(getGalleryStageForStatus("safety_check").label).toBe("Safety");
    expect(getGalleryStageForStatus("in_storage")).toEqual({
      label: "Storage",
      tone: "muted",
    });
    expect(getGalleryStageForStatus("completed")).toEqual({
      label: "Complete",
      tone: "muted",
    });
  });

  it("formats dashboard list items with bike, customer, stage, and next move", () => {
    const item = buildDashboardBikeListItem({
      work_order_id: "wo-3885",
      work_order_number: "3885",
      status: "in_progress",
      flags: ["Incomplete inspection"],
      motorcycle: {
        year: 2025,
        make: "HONDA",
        model: "Monkey",
        customer: {
          first_name: "Dominik",
          last_name: "Szymanski",
        },
      },
      primary_technician: {
        first_name: "Stefano",
        last_name: "Franco",
      },
    });

    expect(item).toEqual({
      workOrderId: "wo-3885",
      href: "/work_orders/wo-3885",
      bikeTitle: "2025 HONDA Monkey",
      subtitle: "Dominik Szymanski · 3885 · Stefano Franco",
      nextMove: "Complete inspection checklist",
      stageLabel: "In bay",
      stageTone: "orange",
    });
  });
});
