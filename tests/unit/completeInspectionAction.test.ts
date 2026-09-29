import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  after,
  completeInspection,
  createThread,
  generateTriggerResponse,
  recordUxFailure,
  requireUser,
  revalidatePath,
  redirect,
  events,
  scheduled,
} = vi.hoisted(() => {
  const events: string[] = [];
  const scheduled: Array<() => Promise<void> | void> = [];
  return {
    events,
    scheduled,
    after: vi.fn((callback: () => Promise<void> | void) => {
      events.push("after");
      scheduled.push(callback);
    }),
    completeInspection: vi.fn(),
    createThread: vi.fn(),
    generateTriggerResponse: vi.fn(),
    recordUxFailure: vi.fn(),
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((destination: string) => {
      events.push(`redirect:${destination}`);
      throw new Error(`NEXT_REDIRECT:${destination}`);
    }),
  };
});

vi.mock("next/server", () => ({ after }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/services/inspections", () => ({
  completeInspection,
  saveInspectionResult: vi.fn(),
}));
vi.mock("@/lib/services/diagnosticsAssistant", () => ({
  createOrReuseDiagnosticsTriggerThreadInternal: createThread,
  generateDiagnosticsTriggerResponseInternal: generateTriggerResponse,
  diagnosticsSafeFailureCode: (error: unknown) =>
    error instanceof Error &&
    /^(?:ASK_OTOMOTO|DIAGNOSTICS)_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "ASK_OTOMOTO_LIFECYCLE_FAILED",
}));
vi.mock("@/lib/services/uxEvents", () => ({ recordUxFailure }));

import { completeInspectionAction } from "@/app/(app)/work_orders/[work_order_id]/inspection/actions";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const INSPECTION = "e1111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";
const USER = "11111111-1111-4111-8111-111111111111";
const LOCATION = "31111111-1111-4111-8111-111111111111";
const THREAD_LOCATION = "61111111-1111-4111-8111-111111111111";

function form(returnTo?: string): FormData {
  const data = new FormData();
  data.set("signature_data_url", "data:image/png;base64,YQ==");
  if (returnTo) data.set("return_to", returnTo);
  return data;
}

describe("completeInspectionAction automatic handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    events.length = 0;
    scheduled.length = 0;
    requireUser.mockResolvedValue({
      user_id: USER,
      auth_user_id: "21111111-1111-4111-8111-111111111111",
      first_name: "Test",
      last_name: "Tech",
      email: "tech@example.invalid",
      profile_photo_path: null,
      role: "service_advisor",
      status: "active",
      location_ids: [LOCATION],
      active_location_id: LOCATION,
    });
    completeInspection.mockImplementation(async () => {
      events.push("inspection-complete");
      return {
        inspectionId: INSPECTION,
        completedAt: "2026-09-29T01:00:00.000Z",
        completedByUserId: USER,
      };
    });
    createThread.mockImplementation(async () => {
      events.push("thread-created");
      return { threadId: THREAD, locationId: THREAD_LOCATION };
    });
    generateTriggerResponse.mockResolvedValue(null);
    recordUxFailure.mockResolvedValue("Could not complete inspection.");
  });

  it("persists inspection before AI setup and schedules generation before office redirect", async () => {
    await expect(completeInspectionAction(WO, { error: null }, form())).rejects.toThrow(
      `NEXT_REDIRECT:/work_orders/${WO}?tab=assistant&thread=${THREAD}`
    );

    expect(events).toEqual([
      "inspection-complete",
      "thread-created",
      "after",
      `redirect:/work_orders/${WO}?tab=assistant&thread=${THREAD}`,
    ]);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(generateTriggerResponse).toHaveBeenCalledWith(
      { userId: USER, locationId: THREAD_LOCATION },
      {
        workOrderId: WO,
        threadId: THREAD,
        trigger: "inspection_completion",
        triggerEntityId: INSPECTION,
      }
    );
    expect(requireUser).toHaveBeenCalledOnce();
  });

  it("keeps AI failure out of the completed inspection result", async () => {
    generateTriggerResponse.mockRejectedValue(new Error("DIAGNOSTICS_AI_NOT_CONFIGURED"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(completeInspectionAction(WO, { error: null }, form())).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    await expect(scheduled[0]!()).resolves.toBeUndefined();

    expect(recordUxFailure).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Inspection assistant generation failed",
      expect.objectContaining({
        work_order_id: WO,
        inspection_id: INSPECTION,
        thread_id: THREAD,
        safe_error_code: "DIAGNOSTICS_AI_NOT_CONFIGURED",
      })
    );
    log.mockRestore();
  });

  it("opens the assistant packet preserving a validated floor job and stage", async () => {
    requireUser.mockResolvedValueOnce({
      ...(await requireUser()),
      role: "technician",
    });
    const returnTo = `/technician?job=${JOB}&wo=${WO}&stage=proof`;

    await expect(
      completeInspectionAction(WO, { error: null }, form(returnTo))
    ).rejects.toThrow(
      `NEXT_REDIRECT:/technician?wo=${WO}&panel=packet&job=${JOB}&packetSection=assistant&stage=proof&assistantThread=${THREAD}`
    );

    expect(createThread).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER }),
      {
        workOrderId: WO,
        jobId: JOB,
        mode: "shop",
        trigger: "inspection_completion",
        triggerEntityId: INSPECTION,
      }
    );
  });

  it("keeps a floor technician on the assistant packet without return_to", async () => {
    requireUser.mockResolvedValueOnce({
      ...(await requireUser()),
      role: "technician",
    });

    await expect(completeInspectionAction(WO, { error: null }, form())).rejects.toThrow(
      `NEXT_REDIRECT:/technician?wo=${WO}&panel=packet&packetSection=assistant&stage=work&assistantThread=${THREAD}`
    );
    expect(createThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: null })
    );
  });

  it("rejects a malicious floor return and uses the office assistant destination", async () => {
    await expect(
      completeInspectionAction(
        WO,
        { error: null },
        form(`https://evil.example/technician?wo=${WO}&job=${JOB}`)
      )
    ).rejects.toThrow(`NEXT_REDIRECT:/work_orders/${WO}?tab=assistant&thread=${THREAD}`);

    expect(createThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: null })
    );
  });

  it("does not turn thread creation failure into inspection failure", async () => {
    createThread.mockRejectedValue(new Error("raw database detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const returnTo = `/technician?job=${JOB}&wo=${WO}&stage=work`;

    await expect(
      completeInspectionAction(WO, { error: null }, form(returnTo))
    ).rejects.toThrow(`NEXT_REDIRECT:${returnTo}`);

    expect(recordUxFailure).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Inspection assistant handoff unavailable", {
      work_order_id: WO,
      inspection_id: INSPECTION,
      safe_error_code: "ASK_OTOMOTO_LIFECYCLE_FAILED",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("raw database detail");
    log.mockRestore();
  });
});
