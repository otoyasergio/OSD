import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askOtomotoCapabilities,
  loadAskOtomotoPanelData,
} from "@/lib/diagnostics/assistantPageState";
import { getAskOtomotoPublicConfig } from "@/lib/diagnostics/config";
import type { UserRole } from "@/lib/database/types";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";

describe("getAskOtomotoPublicConfig", () => {
  it("reports configured and the model alias without exposing the key", () => {
    const config = getAskOtomotoPublicConfig({
      OPENAI_API_KEY: "sk-secret-value",
      OTOMOTO_DIAGNOSTICS_MODEL: "gpt-6-astra",
    });
    expect(config).toEqual({
      configured: true,
      modelLabel: "gpt-6-astra",
      reason: null,
    });
    expect(JSON.stringify(config)).not.toContain("sk-secret");
  });

  it("reports not configured when the key is missing or blank", () => {
    expect(getAskOtomotoPublicConfig({})).toEqual({
      configured: false,
      modelLabel: "gpt-6-astra",
      reason: "not_configured",
    });
    expect(getAskOtomotoPublicConfig({ OPENAI_API_KEY: "  " })).toMatchObject({
      configured: false,
      reason: "not_configured",
    });
  });

  it("hides an invalid model alias and treats it as not configured", () => {
    expect(
      getAskOtomotoPublicConfig({
        OPENAI_API_KEY: "sk-x",
        OTOMOTO_DIAGNOSTICS_MODEL: "bad model<script>",
      })
    ).toEqual({ configured: false, modelLabel: null, reason: "model_invalid" });
  });

  it.each([
    ["OTOMOTO_DIAGNOSTICS_TIMEOUT_MS", "999", "timeout_invalid"],
    ["OTOMOTO_DIAGNOSTICS_TIMEOUT_MS", "abc", "timeout_invalid"],
    ["OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS", "32769", "output_limit_invalid"],
    ["OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS", "1.5", "output_limit_invalid"],
  ])("matches the server config validation when %s=%s", (name, value, reason) => {
    const config = getAskOtomotoPublicConfig({
      OPENAI_API_KEY: "sk-secret-value",
      [name]: value,
    });
    expect(config).toEqual({ configured: false, modelLabel: "gpt-6-astra", reason });
    expect(JSON.stringify(config)).not.toContain("sk-secret");
  });

  it("accepts the same boundary settings the server accepts", () => {
    expect(
      getAskOtomotoPublicConfig({
        OPENAI_API_KEY: "sk-x",
        OTOMOTO_DIAGNOSTICS_MODEL: "gpt-6-sol",
        OTOMOTO_DIAGNOSTICS_TIMEOUT_MS: "120000",
        OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS: "1024",
      })
    ).toEqual({ configured: true, modelLabel: "gpt-6-sol", reason: null });
  });
});

describe("askOtomotoCapabilities", () => {
  const base = {
    surface: "office" as const,
    viewRole: "service_advisor" as UserRole,
    isForeignLocation: false,
    isPreviewing: false,
    workOrderStatus: "in_progress",
  };

  it("gives front-office roles advisor modes and note promotion in the office", () => {
    expect(askOtomotoCapabilities(base)).toEqual({
      canMutate: true,
      preview: false,
      readOnly: false,
      lockReason: null,
      canUseFrontOfficeModes: true,
      canPromoteNotes: true,
    });
  });

  it.each(["technician", "head_tech"] as const)(
    "never gives %s front-office modes",
    (viewRole) => {
      expect(askOtomotoCapabilities({ ...base, viewRole }).canUseFrontOfficeModes).toBe(
        false
      );
      expect(
        askOtomotoCapabilities({ ...base, surface: "floor", viewRole })
      ).toMatchObject({
        canMutate: true,
        canPromoteNotes: true,
        canUseFrontOfficeModes: false,
      });
    }
  );

  it("never offers front-office modes on the floor even for owners", () => {
    expect(
      askOtomotoCapabilities({ ...base, surface: "floor", viewRole: "owner" })
        .canUseFrontOfficeModes
    ).toBe(false);
  });

  it.each(["owner", "manager", "admin"] as const)(
    "mirrors the backend front-office check for %s",
    (viewRole) => {
      expect(askOtomotoCapabilities({ ...base, viewRole })).toMatchObject({
        canMutate: true,
        canUseFrontOfficeModes: true,
        canPromoteNotes: true,
      });
    }
  );

  it.each([
    ["preview", { isPreviewing: true }, "preview", false],
    ["foreign", { isForeignLocation: true }, "foreign", true],
    ["completed", { workOrderStatus: "completed" }, "locked", true],
    ["cancelled", { workOrderStatus: "cancelled" }, "locked", true],
    ["kiosk role", { viewRole: "time_clock_kiosk" as UserRole }, "role", false],
  ])("blocks all writes for %s", (_name, overrides, lockReason, readOnly) => {
    expect(askOtomotoCapabilities({ ...base, ...overrides })).toMatchObject({
      canMutate: false,
      canPromoteNotes: false,
      readOnly,
      lockReason,
    });
  });
});

describe("loadAskOtomotoPanelData", () => {
  const listThreads = vi.fn();
  const loadThread = vi.fn();
  const service = { listThreads, loadThread };
  const thread = (overrides: Record<string, unknown> = {}) => ({
    threadId: THREAD,
    workOrderId: WO,
    jobId: JOB,
    locationId: "31111111-1111-4111-8111-111111111111",
    mode: "shop",
    audience: "technical",
    status: "ready",
    diagnosticPhase: null,
    triggerType: null,
    triggerEntityId: "61111111-1111-4111-8111-111111111111",
    createdByUserId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listThreads.mockResolvedValue([thread()]);
    loadThread.mockResolvedValue({
      thread: thread(),
      messages: [
        {
          messageId: "a1111111-1111-4111-8111-111111111111",
          threadId: THREAD,
          role: "user",
          body: "Look",
          generationStatus: "ready",
          requestedInput: null,
          phase: null,
          safeErrorCode: null,
          parentUserMessageId: null,
          requestedProviderModel: "gpt-6-astra",
          providerModel: "gpt-6-astra-2026",
          createdAt: "2026-09-29T10:00:00.000Z",
          updatedAt: "2026-09-29T10:00:00.000Z",
          photos: [
            {
              photoId: "b1111111-1111-4111-8111-111111111111",
              category: "job_work",
              notes: "Customer Jane Doe 647-555-0100",
              purpose: "Pad wear",
              sortOrder: 0,
              createdAt: "2026-09-29T10:00:00.000Z",
            },
          ],
        },
      ],
    });
  });

  it("loads the list and selected workspace in parallel with the read view", async () => {
    const view = { role: "technician" as UserRole, subjectUserId: "u1" };
    let listStarted = false;
    let loadStartedBeforeListResolved = false;
    listThreads.mockImplementation(async () => {
      listStarted = true;
      await Promise.resolve();
      return [thread()];
    });
    loadThread.mockImplementation(async () => {
      loadStartedBeforeListResolved = listStarted;
      return { thread: thread(), messages: [] };
    });

    const data = await loadAskOtomotoPanelData({
      service,
      surface: "office",
      workOrderId: WO,
      threadId: THREAD,
      readView: view,
      jobLabels: { [JOB]: "Brake service" },
    });

    expect(listThreads).toHaveBeenCalledWith(WO, view);
    expect(loadThread).toHaveBeenCalledWith(WO, THREAD, view);
    expect(loadStartedBeforeListResolved).toBe(true);
    expect(data.threads).toHaveLength(1);
    expect(data.threads[0].jobLabel).toBe("Brake service");
    expect(data.workspace?.thread.threadId).toBe(THREAD);
    expect(data.historyUnavailable).toBe(false);
  });

  it("does not load a workspace without a selected thread", async () => {
    const data = await loadAskOtomotoPanelData({
      service,
      surface: "office",
      workOrderId: WO,
      threadId: null,
      jobLabels: {},
    });
    expect(loadThread).not.toHaveBeenCalled();
    expect(data.workspace).toBeNull();
  });

  it("minimizes the workspace sent to the client", async () => {
    const data = await loadAskOtomotoPanelData({
      service,
      surface: "office",
      workOrderId: WO,
      threadId: THREAD,
      jobLabels: {},
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toMatch(
      /Jane|647|gpt-6-astra-2026|triggerEntityId|createdByUserId/
    );
    expect(data.workspace?.messages[0].photos[0].purpose).toBe("Pad wear");
  });

  it("serializes only allow-listed fields, including future server fields", async () => {
    loadThread.mockResolvedValue({
      thread: { ...thread(), futureSecret: "thread-secret" },
      messages: [
        {
          messageId: "a2222222-2222-4222-8222-222222222222",
          threadId: THREAD,
          role: "assistant",
          body: "Check the fuse",
          generationStatus: "ready",
          requestedInput: {
            type: "photo",
            prompt: "Photo of the fuse box",
            purpose: null,
            tool_placement: null,
            conditions: null,
            units: null,
            rawProviderPayload: "provider-secret",
          },
          phase: "diagnosis",
          safeErrorCode: "OPENAI_TIMEOUT",
          parentUserMessageId: "a1111111-1111-4111-8111-111111111111",
          requestedProviderModel: "gpt-6-astra",
          providerModel: "gpt-6-astra-2026",
          createdAt: "2026-09-29T10:00:00.000Z",
          updatedAt: "2026-09-29T10:00:00.000Z",
          promotedNoteId: "c1111111-1111-4111-8111-111111111111",
          futureSecret: "message-secret",
          photos: [
            {
              photoId: "b1111111-1111-4111-8111-111111111111",
              category: "job_work",
              notes: "Customer Jane Doe",
              purpose: "Fuse box",
              sortOrder: 0,
              createdAt: "2026-09-29T10:00:00.000Z",
              storagePath: "private/path.jpg",
            },
          ],
        },
      ],
    });

    const data = await loadAskOtomotoPanelData({
      service,
      surface: "floor",
      workOrderId: WO,
      threadId: THREAD,
      jobLabels: {},
    });

    expect(data.workspace).toEqual({
      thread: {
        threadId: THREAD,
        workOrderId: WO,
        jobId: JOB,
        mode: "shop",
        audience: "technical",
        status: "ready",
        diagnosticPhase: null,
        triggerType: null,
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:00:00.000Z",
      },
      messages: [
        {
          messageId: "a2222222-2222-4222-8222-222222222222",
          role: "assistant",
          body: "Check the fuse",
          generationStatus: "ready",
          requestedInput: {
            type: "photo",
            prompt: "Photo of the fuse box",
            purpose: null,
            tool_placement: null,
            conditions: null,
            units: null,
          },
          phase: "diagnosis",
          promotedNoteId: "c1111111-1111-4111-8111-111111111111",
          photos: [
            {
              photoId: "b1111111-1111-4111-8111-111111111111",
              category: "job_work",
              purpose: "Fuse box",
              sortOrder: 0,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(data)).not.toMatch(
      /secret|OPENAI_TIMEOUT|locationId|31111111|Jane|private\/path/
    );
  });

  it("keeps the page alive when the list or the selected thread fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    listThreads.mockRejectedValue(new Error("row for Jane Doe failed"));
    loadThread.mockRejectedValue(new Error("ASK_OTOMOTO_THREAD_NOT_FOUND"));
    const data = await loadAskOtomotoPanelData({
      service,
      surface: "office",
      workOrderId: WO,
      threadId: THREAD,
      jobLabels: {},
    });
    expect(data).toEqual({ threads: [], workspace: null, historyUnavailable: true });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Jane");
    warn.mockRestore();
  });

  it("hides front-office threads and workspaces on the floor", async () => {
    listThreads.mockResolvedValue([
      thread(),
      thread({
        threadId: "72222222-2222-4222-8222-222222222222",
        mode: "advisor",
        audience: "front_office",
      }),
    ]);
    loadThread.mockResolvedValue({
      thread: thread({ mode: "intake", audience: "front_office" }),
      messages: [],
    });
    const data = await loadAskOtomotoPanelData({
      service,
      surface: "floor",
      workOrderId: WO,
      threadId: THREAD,
      jobLabels: {},
    });
    expect(data.threads.map((item) => item.mode)).toEqual(["shop"]);
    expect(data.workspace).toBeNull();
  });
});
