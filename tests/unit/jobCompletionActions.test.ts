import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  let workflowV2 = false;
  const afterSuccessfulCompletion = vi.fn(async () => {
    events.push("after");
  });
  return {
    events,
    afterSuccessfulCompletion,
    setWorkflowV2(value: boolean) {
      workflowV2 = value;
    },
    v2WritesEnabled: vi.fn(() => workflowV2),
    readWorkflowV2Flags: vi.fn(() => ({})),
    prepareHandoff: vi.fn(async () => {
      events.push("authenticate-handoff");
      return { afterSuccessfulCompletion };
    }),
    updateJobStatus: vi.fn(async (_jobId: string, status: string) => {
      events.push(`update:${status}`);
    }),
    clearParkOnComplete: vi.fn(async () => {
      events.push("clear-park");
    }),
    requireUser: vi.fn(async () => {
      events.push("domain-auth");
      return { user_id: "11111111-1111-4111-8111-111111111111" };
    }),
    recalculateWorkOrderStatus: vi.fn(async () => {
      events.push("recalculate");
    }),
    getTechnicianFloorOs: vi.fn(async () => {
      events.push("load-floor");
      return {};
    }),
    chooseNextFloorItem: vi.fn(() => ({
      kind: "job",
      job_id: "81111111-1111-4111-8111-111111111111",
      work_order_id: "91111111-1111-4111-8111-111111111111",
    })),
    redirect: vi.fn((destination: string) => {
      events.push(`redirect:${destination}`);
      throw Object.assign(new Error(`NEXT_REDIRECT:${destination}`), {
        digest: `NEXT_REDIRECT;${destination}`,
      });
    }),
    revalidatePath: vi.fn(),
    assertInspectionCompletedForJobFinish: vi.fn(),
    rpc: vi.fn(async () => {
      events.push("v2-complete");
      return { error: null };
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/config/features", () => ({
  readWorkflowV2Flags: mocks.readWorkflowV2Flags,
  v2WritesEnabled: mocks.v2WritesEnabled,
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/services/jobCompletionAssistantHandoff", () => ({
  prepareJobCompletionAssistantHandoff: mocks.prepareHandoff,
}));
vi.mock("@/lib/services/jobs", () => ({
  addJobToWorkOrder: vi.fn(),
  assignTechnicianToJob: vi.fn(),
  pullJob: vi.fn(),
  recordCustomerApproval: vi.fn(),
  recordCustomerDecline: vi.fn(),
  updateJobStatus: mocks.updateJobStatus,
}));
vi.mock("@/lib/services/jobFloorState", () => ({
  acknowledgeDocketJob: vi.fn(),
  clearParkOnComplete: mocks.clearParkOnComplete,
  floorIdempotencyKey: vi.fn(() => "complete:key"),
  parkJob: vi.fn(),
  pullOntoBench: vi.fn(),
  resumeParkedJob: vi.fn(),
  swapBenchJob: vi.fn(),
}));
vi.mock("@/lib/services/inspectionGate", () => ({
  assertInspectionCompletedForJobFinish: mocks.assertInspectionCompletedForJobFinish,
}));
vi.mock("@/lib/status/recalculateWorkOrderStatus", () => ({
  recalculateWorkOrderStatus: mocks.recalculateWorkOrderStatus,
}));
vi.mock("@/lib/technician/nextFloorItem", () => ({
  chooseNextFloorItem: mocks.chooseNextFloorItem,
}));
vi.mock("@/lib/services/technicianFloor", () => ({
  getTechnicianFloorOs: mocks.getTechnicianFloorOs,
}));
vi.mock("@/lib/database/supabase-server", () => ({
  createClient: vi.fn(async () => ({
    from(table: string) {
      if (table === "inspection") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { completed_at: "2026-09-29T00:00:00.000Z" },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
  })),
}));
vi.mock("@/lib/database/supabase-admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/services/errors", () => ({
  toFormErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "UNKNOWN",
  toRpcErrorCode: () => "RPC_FAILED",
}));

import { completeJobFloorAction } from "@/app/(app)/technician/floor-actions";
import { updateJobStatusAction } from "@/app/(app)/work_orders/job-actions";

const WORK_ORDER = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";

function floorForm(): FormData {
  const data = new FormData();
  data.set("work_order_id", WORK_ORDER);
  data.set("job_id", JOB);
  return data;
}

function statusForm(status: string): FormData {
  const data = new FormData();
  data.set("status", status);
  data.set("note", "");
  return data;
}

describe("job-completion action handoffs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.setWorkflowV2(false);
  });

  it.each([
    ["legacy", false, ["update:completed"]],
    ["V2", true, ["domain-auth", "v2-complete"]],
  ] as const)(
    "schedules the %s floor completion handoff after the domain succeeds and before redirect",
    async (_label, workflowV2, domainEvents) => {
      mocks.setWorkflowV2(workflowV2);

      await expect(completeJobFloorAction(null, floorForm())).rejects.toThrow(
        "NEXT_REDIRECT"
      );

      expect(mocks.events[0]).toBe("authenticate-handoff");
      const afterIndex = mocks.events.indexOf("after");
      const redirectIndex = mocks.events.findIndex((event) =>
        event.startsWith("redirect:")
      );
      expect(afterIndex).toBeGreaterThan(
        Math.max(...domainEvents.map((event) => mocks.events.indexOf(event)))
      );
      expect(afterIndex).toBeLessThan(redirectIndex);
      if (!workflowV2) {
        expect(afterIndex).toBeLessThan(mocks.events.indexOf("clear-park"));
      } else {
        expect(afterIndex).toBeLessThan(mocks.events.indexOf("recalculate"));
      }
      expect(mocks.afterSuccessfulCompletion).toHaveBeenCalledWith({
        workOrderId: WORK_ORDER,
        jobId: JOB,
      });
    }
  );

  it.each([
    ["legacy status update", false, mocks.updateJobStatus],
    ["V2 completion RPC", true, mocks.rpc],
  ] as const)("does not hand off when %s fails", async (_label, workflowV2, failure) => {
    mocks.setWorkflowV2(workflowV2);
    failure.mockRejectedValueOnce(new Error("DOMAIN_FAILED"));

    await expect(completeJobFloorAction(null, floorForm())).resolves.toEqual({
      error: "DOMAIN_FAILED",
    });
    expect(mocks.afterSuccessfulCompletion).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the V2 handoff when status recalculation fails after the commit", async () => {
    mocks.setWorkflowV2(true);
    mocks.recalculateWorkOrderStatus.mockRejectedValueOnce(
      new Error("RECALCULATE_FAILED")
    );

    await expect(completeJobFloorAction(null, floorForm())).resolves.toEqual({
      error: "RECALCULATE_FAILED",
    });
    expect(mocks.events).toEqual([
      "authenticate-handoff",
      "domain-auth",
      "v2-complete",
      "after",
    ]);
    expect(mocks.afterSuccessfulCompletion).toHaveBeenCalledOnce();
    expect(mocks.recalculateWorkOrderStatus).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the legacy handoff after completion when later floor cleanup fails", async () => {
    mocks.clearParkOnComplete.mockRejectedValueOnce(new Error("CLEAR_FAILED"));

    await expect(completeJobFloorAction(null, floorForm())).resolves.toEqual({
      error: "CLEAR_FAILED",
    });
    expect(mocks.events).toEqual(["authenticate-handoff", "update:completed", "after"]);
    expect(mocks.afterSuccessfulCompletion).toHaveBeenCalledOnce();
  });

  it("hands off an explicit completed status only after its update succeeds", async () => {
    await expect(
      updateJobStatusAction(WORK_ORDER, JOB, { error: null }, statusForm("completed"))
    ).resolves.toEqual({ error: null });

    expect(mocks.events).toEqual(["authenticate-handoff", "update:completed", "after"]);
    expect(mocks.afterSuccessfulCompletion).toHaveBeenCalledWith({
      workOrderId: WORK_ORDER,
      jobId: JOB,
    });
  });

  it.each(["cancelled", "declined", "in_progress", "pending"])(
    "does not prepare or schedule a handoff for %s",
    async (status) => {
      await updateJobStatusAction(WORK_ORDER, JOB, { error: null }, statusForm(status));

      expect(mocks.prepareHandoff).not.toHaveBeenCalled();
      expect(mocks.afterSuccessfulCompletion).not.toHaveBeenCalled();
      expect(mocks.updateJobStatus).toHaveBeenCalledWith(JOB, status, { note: "" });
    }
  );

  it("does not schedule the completed-status handoff when the update fails", async () => {
    mocks.updateJobStatus.mockRejectedValueOnce(new Error("DOMAIN_FAILED"));

    await expect(
      updateJobStatusAction(WORK_ORDER, JOB, { error: null }, statusForm("completed"))
    ).resolves.toEqual({ error: "DOMAIN_FAILED" });

    expect(mocks.prepareHandoff).toHaveBeenCalledOnce();
    expect(mocks.afterSuccessfulCompletion).not.toHaveBeenCalled();
  });
});
