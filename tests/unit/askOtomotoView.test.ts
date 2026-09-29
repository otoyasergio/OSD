import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MODE_LABELS,
  ASSISTANT_POLL,
  PROMOTABLE_NOTE_TYPES,
  askOtomotoThreadHref,
  assistantDraftPlainText,
  assistantModeOptions,
  canPromoteAssistantMessage,
  isAssistantThreadWorking,
  nextAssistantPollDelay,
  parseCreatedThread,
  parseRequestedInput,
  toAskOtomotoThreadListItems,
} from "@/lib/diagnostics/askOtomotoView";
import type {
  DiagnosticsMessageView,
  DiagnosticsThreadSummary,
} from "@/lib/services/diagnosticsAssistant";

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";

function summary(
  overrides: Partial<DiagnosticsThreadSummary> = {}
): DiagnosticsThreadSummary {
  return {
    threadId: THREAD,
    workOrderId: WO,
    jobId: null,
    locationId: "31111111-1111-4111-8111-111111111111",
    mode: "shop",
    audience: "technical",
    status: "ready",
    diagnosticPhase: "diagnosis",
    triggerType: null,
    triggerEntityId: null,
    createdByUserId: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}

function message(
  overrides: Partial<DiagnosticsMessageView> = {}
): DiagnosticsMessageView {
  return {
    messageId: "a1111111-1111-4111-8111-111111111111",
    threadId: THREAD,
    role: "assistant",
    body: "Draft",
    generationStatus: "ready",
    requestedInput: null,
    phase: "diagnosis",
    safeErrorCode: null,
    parentUserMessageId: null,
    requestedProviderModel: null,
    providerModel: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    photos: [],
    ...overrides,
  };
}

describe("assistant mode labels and options", () => {
  it("labels every mode for staff", () => {
    expect(ASSISTANT_MODE_LABELS).toEqual({
      shop: "Technician (/shop)",
      teach: "Teach (/teach)",
      intake: "Intake",
      advisor: "Service Advisor",
      report: "Report (/report)",
    });
  });

  it("offers only technical modes without front-office capability", () => {
    expect(
      assistantModeOptions({ surface: "office", canUseFrontOfficeModes: false })
    ).toEqual(["shop", "teach", "report"]);
  });

  it("adds intake and advisor in the office for front-office roles", () => {
    expect(
      assistantModeOptions({ surface: "office", canUseFrontOfficeModes: true })
    ).toEqual(["shop", "teach", "report", "intake", "advisor"]);
  });

  it("never offers front-office modes on the floor", () => {
    expect(
      assistantModeOptions({ surface: "floor", canUseFrontOfficeModes: true })
    ).toEqual(["shop", "teach", "report"]);
  });
});

describe("askOtomotoThreadHref", () => {
  it("builds the office tab route with the exact thread", () => {
    expect(askOtomotoThreadHref({ surface: "office", workOrderId: WO }, THREAD)).toBe(
      `/work_orders/${WO}?tab=assistant&thread=${THREAD}`
    );
    expect(askOtomotoThreadHref({ surface: "office", workOrderId: WO }, null)).toBe(
      `/work_orders/${WO}?tab=assistant`
    );
  });

  it("preserves wo, job, stage, panel and packet section on the floor", () => {
    const href = askOtomotoThreadHref(
      { surface: "floor", workOrderId: WO, jobId: JOB, stage: "proof" },
      THREAD
    );
    const url = new URL(href, "https://example.invalid");
    expect(url.pathname).toBe("/technician");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      wo: WO,
      job: JOB,
      stage: "proof",
      panel: "packet",
      packetSection: "assistant",
      assistantThread: THREAD,
    });
  });

  it("drops an invalid thread id instead of propagating it", () => {
    const href = askOtomotoThreadHref(
      { surface: "floor", workOrderId: WO, jobId: null, stage: null },
      "not-a-uuid"
    );
    expect(href).not.toContain("assistantThread");
    expect(
      askOtomotoThreadHref({ surface: "office", workOrderId: WO }, "../../evil")
    ).toBe(`/work_orders/${WO}?tab=assistant`);
  });
});

describe("toAskOtomotoThreadListItems", () => {
  const older = summary({
    threadId: "72222222-2222-4222-8222-222222222222",
    updatedAt: "2026-09-28T10:00:00.000Z",
  });
  const newer = summary({
    threadId: "73333333-3333-4333-8333-333333333333",
    jobId: JOB,
    triggerType: "job_completed",
    updatedAt: "2026-09-29T12:00:00.000Z",
  });
  const advisor = summary({
    threadId: "74444444-4444-4444-8444-444444444444",
    mode: "advisor",
    audience: "front_office",
    updatedAt: "2026-09-29T13:00:00.000Z",
  });

  it("sorts newest-first and returns only minimal display fields", () => {
    const items = toAskOtomotoThreadListItems([older, newer, advisor], {
      surface: "office",
      jobLabels: { [JOB]: "Brake service" },
    });
    expect(items.map((item) => item.threadId)).toEqual([
      advisor.threadId,
      newer.threadId,
      older.threadId,
    ]);
    expect(items[1]).toEqual({
      threadId: newer.threadId,
      jobId: JOB,
      jobLabel: "Brake service",
      mode: "shop",
      audience: "technical",
      status: "ready",
      diagnosticPhase: "diagnosis",
      triggerType: "job_completed",
      createdAt: newer.createdAt,
      updatedAt: newer.updatedAt,
    });
    expect(JSON.stringify(items)).not.toMatch(
      /locationId|createdByUserId|triggerEntityId/
    );
  });

  it("keeps front-office threads off the floor list", () => {
    const items = toAskOtomotoThreadListItems([older, advisor], {
      surface: "floor",
      jobLabels: {},
    });
    expect(items.map((item) => item.threadId)).toEqual([older.threadId]);
  });
});

describe("parseRequestedInput", () => {
  it("maps a supplied requested input to display fields", () => {
    expect(
      parseRequestedInput({
        type: "measurement",
        prompt: "Measure battery voltage",
        purpose: "Confirm charging system",
        tool_placement: "Across battery terminals",
        conditions: "Engine off, 30 minutes rest",
        units: "V",
      })
    ).toEqual({
      type: "measurement",
      label: "Measurement",
      prompt: "Measure battery voltage",
      purpose: "Confirm charging system",
      toolPlacement: "Across battery terminals",
      conditions: "Engine off, 30 minutes rest",
      units: "V",
    });
  });

  it.each([
    ["question", "Question"],
    ["technical_data", "Technical data"],
    ["photo", "Photo"],
    ["test_result", "Test result"],
  ])("labels %s", (type, label) => {
    expect(parseRequestedInput({ type, prompt: "Do it" })?.label).toBe(label);
  });

  it.each([
    null,
    "string",
    { type: "none", prompt: "Nothing" },
    { type: "execute", prompt: "rm -rf" },
    { type: "question", prompt: "   " },
    { type: "question", prompt: 42 },
  ])("ignores unusable input %#", (value) => {
    expect(parseRequestedInput(value)).toBeNull();
  });

  it("drops non-string optional fields", () => {
    expect(
      parseRequestedInput({ type: "question", prompt: "Any noise?", units: { x: 1 } })
    ).toMatchObject({ units: null, purpose: null });
  });
});

describe("parseCreatedThread", () => {
  it("accepts a thread on this work order", () => {
    expect(
      parseCreatedThread(
        { threadId: THREAD, workOrderId: WO, jobId: JOB, mode: "teach", extra: "x" },
        WO
      )
    ).toEqual({ threadId: THREAD, jobId: JOB, mode: "teach" });
  });

  it.each([
    null,
    { threadId: "bad", workOrderId: WO, jobId: null, mode: "shop" },
    {
      threadId: THREAD,
      workOrderId: "49999999-9999-4999-8999-999999999999",
      jobId: null,
      mode: "shop",
    },
    { threadId: THREAD, workOrderId: WO, jobId: "bad", mode: "shop" },
    { threadId: THREAD, workOrderId: WO, jobId: null, mode: "admin" },
  ])("rejects unsafe payload %#", (value) => {
    expect(parseCreatedThread(value, WO)).toBeNull();
  });
});

describe("assistantDraftPlainText", () => {
  it("removes markdown emphasis and bounds the length", () => {
    expect(assistantDraftPlainText("**NEXT STEP:** Check the fuse")).toBe(
      "NEXT STEP: Check the fuse"
    );
    expect(assistantDraftPlainText("x".repeat(9_000))).toHaveLength(8_000);
  });
});

describe("canPromoteAssistantMessage", () => {
  const thread = summary();

  it.each(["shop", "teach", "report"] as const)("allows ready %s drafts", (mode) => {
    expect(
      canPromoteAssistantMessage({
        message: message(),
        thread: { ...thread, mode },
        canPromoteNotes: true,
      })
    ).toBe(true);
  });

  it.each([
    ["advisor mode", { mode: "advisor" as const, audience: "front_office" as const }, {}],
    ["intake mode", { mode: "intake" as const, audience: "front_office" as const }, {}],
    [
      "front_office audience",
      { mode: "shop" as const, audience: "front_office" as const },
      {},
    ],
    ["archived thread", { status: "archived" as const }, {}],
    ["not ready", {}, { generationStatus: "generating" as const }],
    ["user message", {}, { role: "user" as const }],
    ["empty body", {}, { body: null }],
  ])("refuses %s", (_name, threadOverrides, messageOverrides) => {
    expect(
      canPromoteAssistantMessage({
        message: message(messageOverrides),
        thread: { ...thread, ...threadOverrides },
        canPromoteNotes: true,
      })
    ).toBe(false);
  });

  it("refuses without promotion capability", () => {
    expect(
      canPromoteAssistantMessage({ message: message(), thread, canPromoteNotes: false })
    ).toBe(false);
  });
});

describe("promotable note types", () => {
  it("excludes workflow-gating note types", () => {
    const values = PROMOTABLE_NOTE_TYPES.map((option) => option.value);
    expect(values).toEqual([
      "diagnostic_finding",
      "general",
      "customer_concern_confirmed",
      "customer_concern_not_found",
      "parts_issue",
      "internal_warning",
    ]);
    expect(values).not.toContain("quality_check");
    expect(values).not.toContain("road_test");
    expect(values).not.toContain("proof_exception");
  });
});

describe("polling helpers", () => {
  it("backs off from a modest interval to a cap", () => {
    expect(nextAssistantPollDelay(0)).toBe(ASSISTANT_POLL.initialMs);
    expect(ASSISTANT_POLL.initialMs).toBeGreaterThanOrEqual(2_000);
    expect(ASSISTANT_POLL.initialMs).toBeLessThanOrEqual(3_000);
    expect(nextAssistantPollDelay(1)).toBeGreaterThan(nextAssistantPollDelay(0));
    expect(nextAssistantPollDelay(50)).toBe(ASSISTANT_POLL.maxMs);
  });

  it("treats automatic pending and generating threads as working", () => {
    const ws = (
      overrides: Partial<DiagnosticsThreadSummary>,
      messages = [message()]
    ) => ({
      thread: summary(overrides),
      messages,
    });
    expect(isAssistantThreadWorking(ws({ status: "generating" }))).toBe(true);
    expect(
      isAssistantThreadWorking(
        ws({ status: "pending", triggerType: "inspection_completed" }, [])
      )
    ).toBe(true);
    expect(
      isAssistantThreadWorking(ws({ status: "pending", triggerType: null }, []))
    ).toBe(false);
    expect(isAssistantThreadWorking(ws({ status: "ready" }))).toBe(false);
    expect(isAssistantThreadWorking(ws({ status: "failed" }))).toBe(false);
    expect(
      isAssistantThreadWorking(
        ws({ status: "ready" }, [message({ generationStatus: "generating", body: null })])
      )
    ).toBe(true);
  });
});
