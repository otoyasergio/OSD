import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { after, createThread, generateTriggerResponse, requireUser, scheduled, events } =
  vi.hoisted(() => {
    const scheduled: Array<() => Promise<void> | void> = [];
    const events: string[] = [];
    return {
      scheduled,
      events,
      after: vi.fn((callback: () => Promise<void> | void) => {
        events.push("after");
        scheduled.push(callback);
      }),
      createThread: vi.fn(),
      generateTriggerResponse: vi.fn(),
      requireUser: vi.fn(),
    };
  });

vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/services/diagnosticsAssistant", () => ({
  createOrReuseDiagnosticsTriggerThreadInternal: createThread,
  generateDiagnosticsTriggerResponseInternal: generateTriggerResponse,
  diagnosticsSafeFailureCode: (error: unknown) =>
    error instanceof Error &&
    /^(?:ASK_OTOMOTO|DIAGNOSTICS)_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "ASK_OTOMOTO_LIFECYCLE_FAILED",
}));

import { prepareJobCompletionAssistantHandoff } from "@/lib/services/jobCompletionAssistantHandoff";

const WORK_ORDER = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";
const USER = "11111111-1111-4111-8111-111111111111";
const LOCATION = "31111111-1111-4111-8111-111111111111";

describe("job-completion assistant handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduled.length = 0;
    events.length = 0;
    requireUser.mockImplementation(async () => {
      events.push("authenticate");
      return {
        user_id: USER,
        auth_user_id: "21111111-1111-4111-8111-111111111111",
        first_name: "Test",
        last_name: "Tech",
        email: "tech@example.invalid",
        profile_photo_path: null,
        role: "technician",
        status: "active",
        location_ids: [LOCATION],
        active_location_id: LOCATION,
      };
    });
    createThread.mockImplementation(async () => {
      events.push("thread");
      return {
        threadId: THREAD,
        workOrderId: WORK_ORDER,
        jobId: JOB,
        locationId: LOCATION,
        mode: "shop",
        audience: "technical",
        status: "pending",
        diagnosticPhase: null,
        triggerType: "job_completed",
        triggerEntityId: JOB,
        createdByUserId: USER,
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      };
    });
    generateTriggerResponse.mockResolvedValue(null);
  });

  it("authenticates before completion and schedules the exact job trigger afterward", async () => {
    const handoff = await prepareJobCompletionAssistantHandoff();
    events.push("domain-complete");
    await handoff.afterSuccessfulCompletion({
      workOrderId: WORK_ORDER,
      jobId: JOB,
    });

    expect(events).toEqual(["authenticate", "domain-complete", "thread", "after"]);
    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER }),
      {
        workOrderId: WORK_ORDER,
        jobId: JOB,
        mode: "shop",
        trigger: "job_completion",
        triggerEntityId: JOB,
      }
    );
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(generateTriggerResponse).toHaveBeenCalledWith(
      { userId: USER, locationId: LOCATION },
      {
        workOrderId: WORK_ORDER,
        threadId: THREAD,
        jobId: JOB,
        trigger: "job_completion",
        triggerEntityId: JOB,
      }
    );
  });

  it("keeps thread and generation failures out of the successful completion result", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handoff = await prepareJobCompletionAssistantHandoff();
    createThread.mockRejectedValueOnce(new Error("raw private database detail"));

    await expect(
      handoff.afterSuccessfulCompletion({ workOrderId: WORK_ORDER, jobId: JOB })
    ).resolves.toBeUndefined();
    expect(after).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("raw private database detail");

    createThread.mockResolvedValueOnce({
      threadId: THREAD,
      locationId: LOCATION,
      createdByUserId: USER,
    });
    generateTriggerResponse.mockRejectedValueOnce(
      new Error("DIAGNOSTICS_AI_NOT_CONFIGURED")
    );
    await handoff.afterSuccessfulCompletion({ workOrderId: WORK_ORDER, jobId: JOB });
    await expect(scheduled[0]!()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      "Job completion assistant generation failed",
      expect.objectContaining({
        work_order_id: WORK_ORDER,
        job_id: JOB,
        thread_id: THREAD,
        safe_error_code: "DIAGNOSTICS_AI_NOT_CONFIGURED",
      })
    );
    log.mockRestore();
  });

  it("reuses the same thread and lets the atomic seed claim deduplicate repeat actions", async () => {
    const handoff = await prepareJobCompletionAssistantHandoff();

    await handoff.afterSuccessfulCompletion({ workOrderId: WORK_ORDER, jobId: JOB });
    await handoff.afterSuccessfulCompletion({ workOrderId: WORK_ORDER, jobId: JOB });
    await Promise.all(scheduled.map((callback) => callback()));

    expect(createThread).toHaveBeenCalledTimes(2);
    expect(createThread.mock.calls[0]![1]).toEqual(createThread.mock.calls[1]![1]);
    expect(generateTriggerResponse).toHaveBeenCalledTimes(2);
    expect(generateTriggerResponse.mock.calls[0]).toEqual(
      generateTriggerResponse.mock.calls[1]
    );
  });

  it("contains no workflow mutation imports or calls", async () => {
    const source = await readFile(
      new URL("../../lib/services/jobCompletionAssistantHandoff.ts", import.meta.url),
      "utf8"
    );

    expect(source).not.toMatch(
      /services\/(?:jobs|jobChecklist|peerQc|parts|inspections)|recalculateWorkOrderStatus|updateJobStatus|completeJob|toggleJobChecklist|passPeerQualityCheck|passSafetyCheck/
    );
  });
});
