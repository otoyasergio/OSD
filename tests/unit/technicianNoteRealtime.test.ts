import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerTechnicianNoteRealtime } from "@/lib/notes/realtime";

describe("technician note Realtime registration", () => {
  it("listens for new and updated notes on the open work orders", () => {
    const registrations: Array<Record<string, unknown>> = [];
    const channel = {
      on: vi.fn(
        (_kind: string, filter: Record<string, unknown>, _callback: () => void) => {
          registrations.push(filter);
          return channel;
        }
      ),
    };
    const callback = vi.fn();

    expect(registerTechnicianNoteRealtime(channel, ["wo-1"], callback)).toBe(channel);
    expect(registrations).toEqual([
      {
        event: "INSERT",
        schema: "public",
        table: "technician_note",
        filter: "work_order_id=eq.wo-1",
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "technician_note",
        filter: "work_order_id=eq.wo-1",
      },
    ]);
  });

  it("uses an in-filter when several bikes are on the floor", () => {
    const registrations: Array<Record<string, unknown>> = [];
    const channel = {
      on: vi.fn(
        (_kind: string, filter: Record<string, unknown>, _callback: () => void) => {
          registrations.push(filter);
          return channel;
        }
      ),
    };

    registerTechnicianNoteRealtime(channel, ["wo-1", "wo-2"], vi.fn());
    expect(registrations[0]).toMatchObject({
      filter: "work_order_id=in.(wo-1,wo-2)",
    });
  });

  it("does not subscribe to every note in the shop when nothing is open", () => {
    const channel = { on: vi.fn() };
    registerTechnicianNoteRealtime(channel, [], vi.fn());
    expect(channel.on).not.toHaveBeenCalled();
  });
});

describe("note sync wiring", () => {
  it("refreshes the floor when the office saves a note", () => {
    const source = readFileSync(
      join(process.cwd(), "app/(app)/work_orders/note-actions.ts"),
      "utf8"
    );
    expect(source).toContain('revalidatePath("/technician")');
    expect(source).toContain("revalidatePath(`/work_orders/${workOrderId}`)");
  });

  it("subscribes the open floor and the open work order to technician notes", () => {
    const floor = readFileSync(
      join(process.cwd(), "components/technician/TechnicianFloorShell.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "app/(app)/work_orders/[work_order_id]/page.tsx"),
      "utf8"
    );
    expect(floor).toContain("registerTechnicianNoteRealtime");
    expect(page).toContain("WorkOrderNotesSync");
  });
});
