import { describe, expect, it } from "vitest";
import type { DocketItem } from "@/lib/services/technicianDocket";
import {
  benchDropActionForItem,
  canDragDocketItemToBench,
  docketDragId,
  findDocketItemByDragId,
} from "@/lib/technician/benchDrag";

function item(overrides: Partial<DocketItem> = {}): DocketItem {
  return {
    position: 1,
    kind: "assigned",
    key: "work-order-wo-1",
    motorcycle_label: "2024 Honda CB650R",
    service_label: "Oil change",
    service_names: ["Oil change"],
    title: "2024 Honda CB650R · Oil change",
    subtitle: "WO-1001",
    status_label: "Ready To Start",
    job_id: "job-1",
    work_order_id: "wo-1",
    href: "/technician?job=job-1&wo=wo-1",
    overview_href: "/work_orders/wo-1",
    primary_photo_url: null,
    board_status: "next",
    board_stamp: "NEXT",
    floor_park_reason: null,
    floor_wait_owner: null,
    wait_owner_label: "",
    park_reason_label: "",
    state_label: "Ready to pull",
    wait_reason: null,
    wait_owner_kind: null,
    awaiting_customer: false,
    ...overrides,
  };
}

describe("benchDrag", () => {
  it("uses job id for draggable identity", () => {
    expect(docketDragId(item())).toBe("job:job-1");
  });

  it("allows offered, next, and resumable waiting bikes", () => {
    expect(canDragDocketItemToBench(item({ board_status: "offered" }))).toBe(true);
    expect(canDragDocketItemToBench(item({ board_status: "next" }))).toBe(true);
    expect(canDragDocketItemToBench(item({ board_status: "waiting" }))).toBe(true);
  });

  it("blocks bench, QC, and customer-gated bikes", () => {
    expect(
      canDragDocketItemToBench(item({ board_status: "bench", board_stamp: "NOW" }))
    ).toBe(false);
    expect(canDragDocketItemToBench(item({ board_status: "check", job_id: null }))).toBe(
      false
    );
    expect(canDragDocketItemToBench(item({ awaiting_customer: true }))).toBe(false);
  });

  it("maps waiting bikes to resume and others to pull", () => {
    expect(benchDropActionForItem(item({ board_status: "next" }))).toBe("pull");
    expect(benchDropActionForItem(item({ board_status: "waiting" }))).toBe("resume");
    expect(
      benchDropActionForItem(item({ board_status: "bench", board_stamp: "NOW" }))
    ).toBe(null);
  });

  it("finds docket rows by drag id", () => {
    const rows = [
      item(),
      item({ job_id: "job-2", work_order_id: "wo-2", key: "work-order-wo-2" }),
    ];
    expect(findDocketItemByDragId(rows, "job:job-2")?.work_order_id).toBe("wo-2");
  });
});
