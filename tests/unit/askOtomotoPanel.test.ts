// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  refresh,
  push,
  createAssistantThreadAction,
  promoteAssistantNoteAction,
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  uploadAssistantPhotoAction,
} = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  createAssistantThreadAction: vi.fn(),
  promoteAssistantNoteAction: vi.fn(),
  retryAssistantTurnAction: vi.fn(),
  submitAssistantTurnAction: vi.fn(),
  uploadAssistantPhotoAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));
vi.mock("@/app/(app)/work_orders/assistant-actions", () => ({
  createAssistantThreadAction,
  promoteAssistantNoteAction,
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  uploadAssistantPhotoAction,
}));
vi.mock("@/app/(app)/work_orders/note-actions", () => ({
  addTechnicianNoteAction: vi.fn(),
}));

import { AskOtomotoPanel } from "@/components/diagnostics/AskOtomotoPanel";
import { PhotoUploadQueueProvider } from "@/components/photos/PhotoUploadQueueProvider";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";
import {
  ASSISTANT_POLL,
  nextAssistantPollDelay,
  sanitizeRequestedInput,
  type AskOtomotoMessageView,
  type AskOtomotoThreadListItem,
  type AskOtomotoThreadView,
  type AskOtomotoWorkspaceView,
} from "@/lib/diagnostics/askOtomotoView";

type PanelProps = React.ComponentProps<typeof AskOtomotoPanel>;

const WO = "41111111-1111-4111-8111-111111111111";
const JOB = "51111111-1111-4111-8111-111111111111";
const JOB_2 = "52222222-2222-4222-8222-222222222222";
const THREAD = "71111111-1111-4111-8111-111111111111";
const THREAD_2 = "72222222-2222-4222-8222-222222222222";
const ASSISTANT_MSG = "a1111111-1111-4111-8111-111111111111";

const FULL_CAPS: PanelProps["capabilities"] = {
  canMutate: true,
  preview: false,
  readOnly: false,
  lockReason: null,
  canUseFrontOfficeModes: true,
  canPromoteNotes: true,
};

function listItem(
  overrides: Partial<AskOtomotoThreadListItem> = {}
): AskOtomotoThreadListItem {
  return {
    threadId: THREAD,
    jobId: null,
    jobLabel: null,
    mode: "shop",
    audience: "technical",
    status: "ready",
    diagnosticPhase: "diagnosis",
    triggerType: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}

function thread(overrides: Partial<AskOtomotoThreadView> = {}): AskOtomotoThreadView {
  return {
    threadId: THREAD,
    workOrderId: WO,
    jobId: JOB,
    mode: "shop",
    audience: "technical",
    status: "ready",
    diagnosticPhase: "diagnosis",
    triggerType: null,
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides,
  };
}

function assistantMessage(
  overrides: Partial<AskOtomotoMessageView> = {}
): AskOtomotoMessageView {
  return {
    messageId: ASSISTANT_MSG,
    role: "assistant",
    body: "**Assessments:** possible: weak battery\n\n**NEXT STEP:** Measure resting battery voltage.",
    generationStatus: "ready",
    requestedInput: null,
    phase: "diagnosis",
    promotedNoteId: null,
    photos: [],
    ...overrides,
  };
}

function workspace(
  threadOverrides: Partial<AskOtomotoThreadView> = {},
  messages: AskOtomotoMessageView[] = [assistantMessage()]
): AskOtomotoWorkspaceView {
  return { thread: thread(threadOverrides), messages };
}

function props(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    route: { surface: "office", workOrderId: WO },
    threads: [],
    selectedThreadId: null,
    workspace: null,
    jobs: [
      { jobId: JOB, label: "Brake service" },
      { jobId: JOB_2, label: "Oil change" },
    ],
    defaultJobId: null,
    photos: [],
    config: { configured: true, modelLabel: "gpt-6-astra", reason: null },
    capabilities: FULL_CAPS,
    historyUnavailable: false,
    ...overrides,
  };
}

function withThread(
  ws: AskOtomotoWorkspaceView,
  overrides: Partial<PanelProps> = {}
): PanelProps {
  return props({
    threads: [
      listItem({
        threadId: ws.thread.threadId,
        jobId: ws.thread.jobId,
        jobLabel: ws.thread.jobId === JOB ? "Brake service" : null,
        mode: ws.thread.mode,
        audience: ws.thread.audience,
        status: ws.thread.status,
        triggerType: ws.thread.triggerType,
      }),
    ],
    selectedThreadId: ws.thread.threadId,
    workspace: ws,
    ...overrides,
  });
}

describe("AskOtomotoPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function withPhotoQueue(node: React.ReactNode) {
    return React.createElement(
      PhotoUploadQueueProvider,
      {
        userId: "user-a",
        locationId: "location-a",
        store: new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase()),
        isOnline: () => false,
      },
      node
    );
  }

  async function render(p: PanelProps) {
    await act(async () => {
      root.render(withPhotoQueue(React.createElement(AskOtomotoPanel, p)));
    });
  }

  const buttons = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  const buttonNamed = (pattern: RegExp) =>
    buttons().find((b) =>
      pattern.test(b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "")
    );
  const alerts = () =>
    Array.from(container.querySelectorAll('[role="alert"]')).map(
      (node) => node.textContent
    );
  const statuses = () =>
    Array.from(container.querySelectorAll('[role="status"]')).map(
      (node) => node.textContent
    );
  const nav = () =>
    container.querySelector<HTMLElement>('nav[aria-label="Ask OTOMOTO conversations"]');
  const modeRadios = () =>
    Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="radio"][name="mode"]')
    );
  const createForm = () =>
    container.querySelector<HTMLFormElement>(
      'form[aria-label="Start a new conversation"]'
    );
  const createButton = () =>
    buttons().find((b) =>
      /^(start conversation|starting)/i.test(b.textContent?.trim() ?? "")
    );

  async function setValue(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ) {
    await act(async () => {
      const proto =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        })
      );
    });
  }

  async function click(element: HTMLElement | null | undefined) {
    expect(element).toBeTruthy();
    await act(async () => {
      element!.click();
    });
  }

  describe("thread history", () => {
    const threads = [
      listItem({
        threadId: THREAD_2,
        jobId: JOB,
        jobLabel: "Brake service",
        triggerType: "job_completed",
        diagnosticPhase: "closure_report",
        updatedAt: "2026-09-29T12:00:00.000Z",
      }),
      listItem({
        threadId: THREAD,
        mode: "teach",
        triggerType: "inspection_completed",
        status: "failed",
        diagnosticPhase: null,
        updatedAt: "2026-09-28T09:00:00.000Z",
      }),
    ];

    it("lists visible threads in server order with mode, scope, badges, status and exact links", async () => {
      await render(props({ threads, selectedThreadId: THREAD_2 }));

      const links = Array.from(nav()!.querySelectorAll("a"));
      expect(links).toHaveLength(2);
      expect(links[0].getAttribute("href")).toBe(
        `/work_orders/${WO}?tab=assistant&thread=${THREAD_2}`
      );
      expect(links[1].getAttribute("href")).toBe(
        `/work_orders/${WO}?tab=assistant&thread=${THREAD}`
      );
      expect(links[0].textContent).toContain("Technician (/shop)");
      expect(links[0].textContent).toContain("Brake service");
      expect(links[0].textContent).toContain("Automatic job-completion review");
      expect(links[0].textContent).toContain("Ready");
      expect(links[0].textContent).toContain("Closure report");
      expect(links[0].querySelector("time")?.getAttribute("dateTime")).toBe(
        "2026-09-29T12:00:00.000Z"
      );
      expect(links[1].textContent).toContain("Teach (/teach)");
      expect(links[1].textContent).toContain("Whole work order");
      expect(links[1].textContent).toContain("Automatic arrival-inspection review");
      expect(links[1].textContent).toContain("Failed");
      expect(links[0].getAttribute("aria-current")).toBe("page");
      expect(links[1].hasAttribute("aria-current")).toBe(false);
    });

    it("shows history and a new conversation when nothing is selected", async () => {
      await render(props({ threads }));
      expect(nav()).not.toBeNull();
      expect(createForm()).not.toBeNull();
      expect(container.textContent).not.toMatch(/unavailable/i);
      expect(alerts()).toEqual([]);
    });

    it("keeps the list and shows a nonfatal alert for a stale selected thread", async () => {
      await render(
        props({ threads, selectedThreadId: "79999999-9999-4999-8999-999999999999" })
      );
      expect(alerts().join(" ")).toMatch(/selected conversation is unavailable/i);
      expect(nav()!.querySelectorAll("a")).toHaveLength(2);
      expect(createForm()).not.toBeNull();
    });

    it("invites a new conversation when there is no history", async () => {
      await render(props());
      expect(container.textContent).toContain("No conversations yet");
      expect(createForm()).not.toBeNull();
      expect(createButton()?.disabled).toBe(false);
    });

    it("reports history that could not load without blocking a new conversation", async () => {
      await render(props({ historyUnavailable: true }));
      expect(alerts().join(" ")).toMatch(/history could not be loaded/i);
      expect(container.textContent).not.toMatch(/no conversations yet/i);
      expect(createForm()).not.toBeNull();
    });

    it("links to a fresh conversation from a selected thread instead of changing its mode", async () => {
      await render(withThread(workspace()));
      expect(createForm()).toBeNull();
      expect(modeRadios()).toHaveLength(0);
      const newLink = Array.from(container.querySelectorAll("a")).find((a) =>
        /new conversation/i.test(a.textContent ?? "")
      );
      expect(newLink?.getAttribute("href")).toBe(`/work_orders/${WO}?tab=assistant`);
      expect(container.textContent).toContain("Mode: Technician (/shop)");
    });
  });

  describe("new conversation modes", () => {
    const labels = () =>
      modeRadios().map(
        (radio) => container.querySelector(`label[for="${radio.id}"]`)?.textContent ?? ""
      );

    it("offers all five modes to front-office staff in the office", async () => {
      await render(props());
      expect(modeRadios().map((radio) => radio.value)).toEqual([
        "shop",
        "teach",
        "report",
        "intake",
        "advisor",
      ]);
      expect(labels().join("|")).toMatch(
        /Technician \(\/shop\).*Teach \(\/teach\).*Report \(\/report\).*Intake.*Service Advisor/
      );
      expect(modeRadios()[0].checked).toBe(true);
      expect(container.querySelector("fieldset legend")?.textContent).toMatch(/mode/i);
    });

    it("offers only technical modes without front-office capability", async () => {
      await render(
        props({ capabilities: { ...FULL_CAPS, canUseFrontOfficeModes: false } })
      );
      expect(modeRadios().map((radio) => radio.value)).toEqual([
        "shop",
        "teach",
        "report",
      ]);
    });

    it("never offers intake or advisor on the floor", async () => {
      await render(
        props({
          route: { surface: "floor", workOrderId: WO, jobId: JOB, stage: "work" },
          jobs: [{ jobId: JOB, label: "Brake service" }],
          defaultJobId: JOB,
        })
      );
      expect(modeRadios().map((radio) => radio.value)).toEqual([
        "shop",
        "teach",
        "report",
      ]);
      expect(container.textContent).not.toMatch(/Service Advisor|Intake/);
    });

    it("describes report drafts as non-statutory with no official template", async () => {
      await render(props());
      expect(container.textContent).toMatch(/not a statutory inspection certificate/i);
      expect(container.textContent).toMatch(
        /official .*template .*(unavailable|not installed)/i
      );
    });

    it("offers an optional office job selector limited to this work order", async () => {
      await render(props());
      const select = container.querySelector<HTMLSelectElement>("select[name='job_id']")!;
      expect(container.querySelector(`label[for="${select.id}"]`)?.textContent).toMatch(
        /job/i
      );
      expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
        ["", "Whole work order"],
        [JOB, "Brake service"],
        [JOB_2, "Oil change"],
      ]);
    });

    it("preselects the current floor job without a cross-job selector", async () => {
      await render(
        props({
          route: { surface: "floor", workOrderId: WO, jobId: JOB, stage: "work" },
          jobs: [{ jobId: JOB, label: "Brake service" }],
          defaultJobId: JOB,
        })
      );
      expect(container.querySelector("select[name='job_id']")).toBeNull();
      expect(
        createForm()!.querySelector<HTMLInputElement>(
          "input[type='hidden'][name='job_id']"
        )?.value
      ).toBe(JOB);
      expect(createForm()!.textContent).toContain("Brake service");
    });
  });

  describe("creating a conversation", () => {
    it("submits the fixed mode and job, then navigates to the exact safe route", async () => {
      createAssistantThreadAction.mockResolvedValue({
        status: "success",
        error: null,
        data: { threadId: THREAD, workOrderId: WO, jobId: JOB, mode: "teach" },
      });
      await render(props());
      await click(modeRadios().find((radio) => radio.value === "teach"));
      await setValue(
        container.querySelector<HTMLSelectElement>("select[name='job_id']")!,
        JOB
      );
      await act(async () => createForm()!.requestSubmit());

      expect(createAssistantThreadAction).toHaveBeenCalledTimes(1);
      const [workOrderId, , form] = createAssistantThreadAction.mock.calls[0] as [
        string,
        unknown,
        FormData,
      ];
      expect(workOrderId).toBe(WO);
      expect(form.get("mode")).toBe("teach");
      expect(form.get("job_id")).toBe(JOB);
      expect(push).toHaveBeenCalledWith(
        `/work_orders/${WO}?tab=assistant&thread=${THREAD}`
      );
    });

    it("keeps floor route state when navigating to the new thread", async () => {
      createAssistantThreadAction.mockResolvedValue({
        status: "success",
        error: null,
        data: { threadId: THREAD, workOrderId: WO, jobId: JOB, mode: "shop" },
      });
      await render(
        props({
          route: { surface: "floor", workOrderId: WO, jobId: JOB, stage: "proof" },
          jobs: [{ jobId: JOB, label: "Brake service" }],
          defaultJobId: JOB,
        })
      );
      await act(async () => createForm()!.requestSubmit());
      const [, , form] = createAssistantThreadAction.mock.calls[0] as [
        string,
        unknown,
        FormData,
      ];
      expect(form.get("job_id")).toBe(JOB);
      expect(form.get("mode")).toBe("shop");
      const href = push.mock.calls[0][0] as string;
      const url = new URL(href, "https://example.invalid");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        wo: WO,
        job: JOB,
        stage: "proof",
        panel: "packet",
        packetSection: "assistant",
        assistantThread: THREAD,
      });
    });

    it("refuses to navigate for an unsafe returned thread", async () => {
      createAssistantThreadAction.mockResolvedValue({
        status: "success",
        error: null,
        data: {
          threadId: THREAD,
          workOrderId: "49999999-9999-4999-8999-999999999999",
          jobId: null,
          mode: "shop",
        },
      });
      await render(props());
      await act(async () => createForm()!.requestSubmit());
      expect(push).not.toHaveBeenCalled();
      expect(alerts().join(" ")).toMatch(/could not open the new conversation/i);
    });

    it("shows a create error and keeps the selections", async () => {
      createAssistantThreadAction.mockResolvedValue({
        status: "error",
        error: "You can't use this mode.",
      });
      await render(props());
      await click(modeRadios().find((radio) => radio.value === "report"));
      await act(async () => createForm()!.requestSubmit());
      expect(alerts()).toContain("You can't use this mode.");
      expect(modeRadios().find((radio) => radio.checked)?.value).toBe("report");
      expect(push).not.toHaveBeenCalled();
    });

    it("never creates when AI configuration is missing", async () => {
      await render(
        props({
          config: { configured: false, modelLabel: null, reason: "not_configured" },
        })
      );
      expect(createButton()?.disabled).toBe(true);
      await act(async () => createForm()!.requestSubmit());
      expect(createAssistantThreadAction).not.toHaveBeenCalled();
      expect(container.textContent).toMatch(/not configured/i);
      expect(container.textContent).toMatch(/owner or manager/i);
      expect(container.textContent).not.toMatch(/sk-/);
    });

    it.each([
      [
        "preview",
        { ...FULL_CAPS, canMutate: false, preview: true, lockReason: "preview" },
        /role preview/i,
      ],
      [
        "foreign",
        { ...FULL_CAPS, canMutate: false, readOnly: true, lockReason: "foreign" },
        /another location/i,
      ],
      [
        "locked",
        { ...FULL_CAPS, canMutate: false, readOnly: true, lockReason: "locked" },
        /completed or cancelled/i,
      ],
      ["role", { ...FULL_CAPS, canMutate: false, lockReason: "role" }, /cannot start/i],
    ] as const)(
      "explains and blocks creation when %s",
      async (_name, capabilities, copy) => {
        await render(props({ capabilities: capabilities as PanelProps["capabilities"] }));
        expect(createButton()?.disabled).toBe(true);
        expect(container.textContent).toMatch(copy);
        await act(async () => createForm()!.requestSubmit());
        expect(createAssistantThreadAction).not.toHaveBeenCalled();
      }
    );
  });

  describe("configuration and reference disclosure", () => {
    it("always discloses the lack of live lookups and missing shop references", async () => {
      await render(props());
      const text = container.textContent ?? "";
      expect(text).toMatch(
        /no live OEM, service manual, web, recall, or Ontario inspection lookup/i
      );
      expect(text).toMatch(/not installed/i);
      expect(text).toMatch(/diagnostic tree/i);
      expect(text).toMatch(/inspection report template/i);
      expect(text).toContain("gpt-6-astra");
    });

    it.each(["model_invalid", "timeout_invalid", "output_limit_invalid"] as const)(
      "explains invalid server settings (%s) without asking for a key",
      async (reason) => {
        await render(props({ config: { configured: false, modelLabel: null, reason } }));
        const text = container.textContent ?? "";
        expect(text).toMatch(/settings on this server are invalid/i);
        expect(text).not.toMatch(/add the OpenAI API key/i);
        expect(createButton()?.disabled).toBe(true);
      }
    );

    it("keeps history readable and copyable but disables generation when not configured", async () => {
      await render(
        withThread(workspace({ status: "failed" }), {
          config: { configured: false, modelLabel: null, reason: "not_configured" },
          photos: [
            {
              photo_id: "b1111111-1111-4111-8111-111111111111",
              work_order_id: WO,
              job_id: JOB,
              category: "job_work",
              created_at: "2026-09-29T10:00:00.000Z",
              thumb_url: "https://signed.example/t.jpg",
            },
          ],
        })
      );
      expect(container.textContent).toContain("Measure resting battery voltage.");
      expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(
        true
      );
      expect(buttonNamed(/^retry/i)).toBeUndefined();
      expect(
        Array.from(
          container.querySelectorAll<HTMLInputElement>('input[type="file"]')
        ).every((input) => input.disabled)
      ).toBe(true);
      expect(buttonNamed(/copy ai draft/i)).toBeDefined();
      expect(buttonNamed(/review and save as note/i)).toBeDefined();
    });
  });

  describe("existing thread", () => {
    it("labels every assistant output as an AI draft", async () => {
      await render(
        withThread(
          workspace({}, [
            assistantMessage(),
            assistantMessage({
              messageId: "a2222222-2222-4222-8222-222222222222",
              role: "user",
              body: "Battery is 12.1 V",
            }),
            assistantMessage({ messageId: "a3333333-3333-4333-8333-333333333333" }),
          ])
        )
      );
      const labels = Array.from(container.querySelectorAll("article")).filter((article) =>
        article.textContent?.includes("AI draft — staff review required")
      );
      expect(labels).toHaveLength(2);
    });

    it("renders a requested-input card and keeps exactly one NEXT STEP from the body", async () => {
      await render(
        withThread(
          workspace({}, [
            assistantMessage({
              requestedInput: {
                type: "measurement",
                prompt: "Measure resting battery voltage",
                purpose: "Confirm state of charge",
                tool_placement: "Red probe on +, black probe on −",
                conditions: "Engine off for 30 minutes",
                units: "V",
              },
            }),
          ])
        )
      );
      const card = container.querySelector<HTMLElement>(
        '[role="region"][aria-label="Next evidence requested"]'
      )!;
      expect(card).not.toBeNull();
      const text = card.textContent ?? "";
      expect(text).toContain("Measurement");
      expect(text).toContain("Measure resting battery voltage");
      expect(text).toContain("Confirm state of charge");
      expect(text).toContain("Red probe on +, black probe on −");
      expect(text).toContain("Engine off for 30 minutes");
      expect(text).toContain("V");
      expect(text).not.toMatch(/NEXT STEP/);
      expect(text).toMatch(/answer in the message box below/i);
      expect((container.textContent ?? "").match(/NEXT STEP/g)).toHaveLength(1);
      expect(card.querySelector("button")).toBeNull();
    });

    it.each([
      ["question", "Question"],
      ["technical_data", "Technical data"],
      ["photo", "Photo"],
      ["test_result", "Test result"],
    ])("labels a %s request", async (type, label) => {
      await render(
        withThread(
          workspace({}, [
            assistantMessage({
              requestedInput: sanitizeRequestedInput({ type, prompt: "Provide it" }),
            }),
          ])
        )
      );
      const card = container.querySelector('[aria-label="Next evidence requested"]');
      expect(card?.textContent).toContain(label);
      expect(card?.textContent).toContain("Provide it");
    });

    it.each([
      [
        "preview",
        { ...FULL_CAPS, canMutate: false, preview: true, lockReason: "preview" },
      ],
      [
        "foreign",
        { ...FULL_CAPS, canMutate: false, readOnly: true, lockReason: "foreign" },
      ],
      ["role", { ...FULL_CAPS, canMutate: false, lockReason: "role" }],
    ] as const)(
      "does not point to the message box when the composer is locked (%s)",
      async (_name, capabilities) => {
        await render(
          withThread(
            workspace({}, [
              assistantMessage({
                requestedInput: sanitizeRequestedInput({
                  type: "measurement",
                  prompt: "Measure battery voltage",
                }),
              }),
            ]),
            { capabilities: capabilities as PanelProps["capabilities"] }
          )
        );
        const card = container.querySelector('[aria-label="Next evidence requested"]')!;
        expect(card.textContent).toContain("Measure battery voltage");
        expect(card.textContent).not.toMatch(/message box below/i);
        expect(card.textContent).toMatch(/never runs a test/i);
      }
    );

    it("does not point to the message box when sending is unconfigured", async () => {
      await render(
        withThread(
          workspace({}, [
            assistantMessage({
              requestedInput: sanitizeRequestedInput({
                type: "question",
                prompt: "Noise?",
              }),
            }),
          ]),
          { config: { configured: false, modelLabel: null, reason: "not_configured" } }
        )
      );
      const card = container.querySelector('[aria-label="Next evidence requested"]')!;
      expect(card.textContent).not.toMatch(/message box below/i);
    });

    it("omits the card for no requested input", async () => {
      await render(
        withThread(
          workspace({}, [
            assistantMessage({
              requestedInput: sanitizeRequestedInput({ type: "none", prompt: "Nothing" }),
            }),
          ])
        )
      );
      expect(
        container.querySelector('[aria-label="Next evidence requested"]')
      ).toBeNull();
    });

    it("lets a manual pending thread compose but locks an automatic pending one", async () => {
      await render(withThread(workspace({ status: "pending", triggerType: null }, [])));
      expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(
        false
      );

      await render(
        withThread(
          workspace({ status: "pending", triggerType: "inspection_completed" }, [])
        )
      );
      expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(
        true
      );
      expect(statuses().join(" ")).toMatch(/pending automatic review/i);
    });

    it("renders message bodies as plain text", async () => {
      await render(
        withThread(
          workspace({}, [
            assistantMessage({ body: "<img src=x onerror=alert(1)> check" }),
          ])
        )
      );
      expect(container.querySelector("img[src='x']")).toBeNull();
      expect(container.textContent).toContain("<img src=x onerror=alert(1)> check");
    });
  });

  describe("pending polling", () => {
    it("refreshes on a modest backoff while generating and stops when ready", async () => {
      vi.useFakeTimers();
      const generating = workspace({ status: "generating" }, [
        assistantMessage({ generationStatus: "generating", body: null }),
      ]);
      await render(withThread(generating));
      expect(refresh).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.initialMs - 1);
      });
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(nextAssistantPollDelay(1));
      });
      expect(refresh).toHaveBeenCalledTimes(2);

      await render(withThread(workspace({ status: "ready" })));
      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 5);
      });
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it("polls an automatic pending thread and stops after the timeout", async () => {
      vi.useFakeTimers();
      await render(
        withThread(workspace({ status: "pending", triggerType: "job_completed" }, []))
      );
      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.timeoutMs + ASSISTANT_POLL.maxMs);
      });
      const calls = refresh.mock.calls.length;
      expect(calls).toBeGreaterThan(2);
      expect(calls).toBeLessThan(ASSISTANT_POLL.timeoutMs / ASSISTANT_POLL.initialMs);
      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 10);
      });
      expect(refresh).toHaveBeenCalledTimes(calls);
      expect(statuses().join(" ")).toMatch(/still working\. use refresh to check again/i);
      expect(buttonNamed(/^refresh$/i)).toBeDefined();
    });

    it("stops polling on failure and on unmount", async () => {
      vi.useFakeTimers();
      await render(withThread(workspace({ status: "generating" }, [])));
      await render(withThread(workspace({ status: "failed" }, [])));
      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 3);
      });
      expect(refresh).not.toHaveBeenCalled();

      await render(withThread(workspace({ status: "generating" }, [])));
      await act(async () => root.unmount());
      root = createRoot(container);
      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 3);
      });
      expect(refresh).not.toHaveBeenCalled();
    });

    function setVisibility(state: "visible" | "hidden") {
      Object.defineProperty(document, "visibilityState", {
        value: state,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }

    it("counts only visible time toward the timeout and resumes when visible", async () => {
      vi.useFakeTimers();
      try {
        await render(withThread(workspace({ status: "generating" }, [])));
        await act(async () => {
          vi.advanceTimersByTime(ASSISTANT_POLL.initialMs);
        });
        expect(refresh).toHaveBeenCalledTimes(1);

        await act(async () => setVisibility("hidden"));
        await act(async () => {
          vi.advanceTimersByTime(ASSISTANT_POLL.timeoutMs * 2);
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(statuses().join(" ")).not.toMatch(/use refresh to check again/i);

        await act(async () => setVisibility("visible"));
        await act(async () => {
          vi.advanceTimersByTime(nextAssistantPollDelay(1));
        });
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(statuses().join(" ")).not.toMatch(/use refresh to check again/i);

        await act(async () => {
          vi.advanceTimersByTime(ASSISTANT_POLL.timeoutMs);
        });
        expect(statuses().join(" ")).toMatch(/use refresh to check again/i);
      } finally {
        setVisibility("visible");
      }
    });

    it("keeps the elapsed time of a partly visible interval across a hide", async () => {
      vi.useFakeTimers();
      try {
        await render(withThread(workspace({ status: "generating" }, [])));
        await act(async () => {
          vi.advanceTimersByTime(ASSISTANT_POLL.initialMs - 1000);
        });
        await act(async () => setVisibility("hidden"));
        await act(async () => {
          vi.advanceTimersByTime(60_000);
        });
        await act(async () => setVisibility("visible"));
        await act(async () => {
          vi.advanceTimersByTime(999);
        });
        expect(refresh).not.toHaveBeenCalled();
        await act(async () => {
          vi.advanceTimersByTime(1);
        });
        expect(refresh).toHaveBeenCalledTimes(1);
      } finally {
        setVisibility("visible");
      }
    });

    it("starts paused when hidden and leaves no timers or listeners after unmount", async () => {
      vi.useFakeTimers();
      try {
        setVisibility("hidden");
        await render(withThread(workspace({ status: "generating" }, [])));
        await act(async () => {
          vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 3);
        });
        expect(refresh).not.toHaveBeenCalled();

        await act(async () => root.unmount());
        root = createRoot(container);
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => setVisibility("visible"));
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => {
          vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 3);
        });
        expect(refresh).not.toHaveBeenCalled();
      } finally {
        setVisibility("visible");
      }
    });

    it("does not poll a ready or manual pending thread", async () => {
      vi.useFakeTimers();
      await render(withThread(workspace({ status: "pending", triggerType: null }, [])));
      await act(async () => {
        vi.advanceTimersByTime(ASSISTANT_POLL.maxMs * 3);
      });
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  describe("copy", () => {
    function mockClipboard(writeText: ReturnType<typeof vi.fn> | undefined) {
      Object.defineProperty(navigator, "clipboard", {
        value: writeText ? { writeText } : undefined,
        configurable: true,
      });
    }

    it("copies the draft text and announces success", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      mockClipboard(writeText);
      await render(withThread(workspace()));
      await click(buttonNamed(/copy ai draft/i));
      expect(writeText).toHaveBeenCalledWith(
        "Assessments: possible: weak battery\n\nNEXT STEP: Measure resting battery voltage."
      );
      expect(statuses().join(" ")).toMatch(/copied/i);
    });

    it("copies an advisor draft without markdown markers but with its line breaks", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      mockClipboard(writeText);
      await render(
        withThread(
          workspace({ mode: "advisor", audience: "front_office" }, [
            assistantMessage({
              body: "## Summary\n**Your brakes** need pads.\n\n\n\n- Front pads worn  \n- Rotors OK",
            }),
          ])
        )
      );
      await click(buttonNamed(/copy ai draft/i));
      expect(writeText).toHaveBeenCalledWith(
        "Summary\nYour brakes need pads.\n\n- Front pads worn\n- Rotors OK"
      );
    });

    it.each([
      ["rejected", vi.fn().mockRejectedValue(new Error("denied"))],
      ["unavailable", undefined],
    ])("announces failure when the clipboard is %s", async (_name, writeText) => {
      mockClipboard(writeText as ReturnType<typeof vi.fn> | undefined);
      await render(withThread(workspace()));
      await click(buttonNamed(/copy ai draft/i));
      expect(alerts().join(" ")).toMatch(/copy failed/i);
    });
  });

  describe("review and save as note", () => {
    const reviewButton = () => buttonNamed(/review and save as note/i);
    const noteText = () =>
      container.querySelector<HTMLTextAreaElement>(
        "textarea[name='text'][id^='note-text']"
      )!;
    const reviewForm = () =>
      container.querySelector<HTMLFormElement>(
        'form[aria-label="Review AI draft as note"]'
      )!;
    const confirm = () =>
      reviewForm().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const saveButton = () =>
      Array.from(reviewForm().querySelectorAll("button")).find((b) =>
        /^(save note|saving)/i.test(b.textContent?.trim() ?? "")
      )!;

    it.each(["shop", "teach", "report"] as const)(
      "is offered for ready %s drafts",
      async (mode) => {
        await render(withThread(workspace({ mode })));
        expect(reviewButton()).toBeDefined();
      }
    );

    it("opens a focused plain-text editor with allowed note types and the locked thread job", async () => {
      await render(withThread(workspace()));
      await click(reviewButton());
      expect(reviewForm()).not.toBeNull();
      expect(document.activeElement).toBe(noteText());
      expect(noteText().value).toBe(
        "Assessments: possible: weak battery\n\nNEXT STEP: Measure resting battery voltage."
      );
      const types = Array.from(
        reviewForm().querySelectorAll<HTMLOptionElement>(
          "select[name='note_type'] option"
        )
      ).map((o) => o.value);
      expect(types).toEqual([
        "diagnostic_finding",
        "general",
        "customer_concern_confirmed",
        "customer_concern_not_found",
        "parts_issue",
        "internal_warning",
      ]);
      expect(reviewForm().querySelector("select[name='job_id']")).toBeNull();
      expect(
        reviewForm().querySelector<HTMLInputElement>(
          "input[type='hidden'][name='job_id']"
        )?.value
      ).toBe(JOB);
      expect(reviewForm().textContent).toContain("Brake service");
      expect(saveButton().disabled).toBe(true);
    });

    it("requires explicit confirmation, then saves the edited text once and refreshes", async () => {
      promoteAssistantNoteAction.mockResolvedValue({
        status: "success",
        error: null,
        data: {},
      });
      await render(withThread(workspace()));
      await click(reviewButton());
      await setValue(noteText(), "Battery rested at 12.1 V; charge and retest.");
      await act(async () => reviewForm().requestSubmit());
      expect(promoteAssistantNoteAction).not.toHaveBeenCalled();

      await click(confirm());
      expect(saveButton().disabled).toBe(false);
      await act(async () => reviewForm().requestSubmit());

      expect(promoteAssistantNoteAction).toHaveBeenCalledTimes(1);
      const [workOrderId, , form] = promoteAssistantNoteAction.mock.calls[0] as [
        string,
        unknown,
        FormData,
      ];
      expect(workOrderId).toBe(WO);
      expect(form.get("source_message_id")).toBe(ASSISTANT_MSG);
      expect(form.get("job_id")).toBe(JOB);
      expect(form.get("note_type")).toBe("diagnostic_finding");
      expect(form.get("text")).toBe("Battery rested at 12.1 V; charge and retest.");
      expect(refresh).toHaveBeenCalled();
      expect(statuses().join(" ")).toMatch(/saved as a technician note/i);
      expect(reviewButton()).toBeUndefined();
    });

    it("sends an empty job for a work-order-level thread", async () => {
      promoteAssistantNoteAction.mockResolvedValue({ status: "success", error: null });
      await render(withThread(workspace({ jobId: null })));
      await click(reviewButton());
      expect(reviewForm().textContent).toContain("Whole work order");
      await click(confirm());
      await act(async () => reviewForm().requestSubmit());
      const [, , form] = promoteAssistantNoteAction.mock.calls[0] as [
        string,
        unknown,
        FormData,
      ];
      expect(form.get("job_id")).toBe("");
    });

    it("keeps the edited text and shows the error when saving fails", async () => {
      promoteAssistantNoteAction.mockResolvedValue({
        status: "error",
        error: "This draft was already saved as a note.",
      });
      await render(withThread(workspace()));
      await click(reviewButton());
      await setValue(noteText(), "Edited");
      await click(confirm());
      await act(async () => reviewForm().requestSubmit());
      expect(alerts()).toContain("This draft was already saved as a note.");
      expect(noteText().value).toBe("Edited");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("blocks saving blank text even when confirmed", async () => {
      await render(withThread(workspace()));
      await click(reviewButton());
      await setValue(noteText(), "   ");
      await click(confirm());
      expect(saveButton().disabled).toBe(true);
      await act(async () => reviewForm().requestSubmit());
      expect(promoteAssistantNoteAction).not.toHaveBeenCalled();
    });

    const reviewButtons = () => Array.from(reviewForm().querySelectorAll("button"));
    const cancelButton = () =>
      reviewButtons().find((b) => /^cancel$/i.test(b.textContent ?? ""));
    const discardButton = () => buttonNamed(/^discard changes$/i);
    const keepEditingButton = () => buttonNamed(/^keep editing$/i);
    const pressEscape = async (init: KeyboardEventInit = {}) =>
      act(async () => {
        noteText().dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...init })
        );
      });

    it("ignores Escape while an IME composition is active", async () => {
      await render(withThread(workspace()));
      await click(reviewButton());
      await pressEscape({ isComposing: true });
      expect(reviewForm()).not.toBeNull();
      await pressEscape({ keyCode: 229 });
      expect(reviewForm()).not.toBeNull();
    });

    it("asks before discarding edited text on Cancel and can keep editing", async () => {
      await render(withThread(workspace()));
      await click(reviewButton());
      await setValue(noteText(), "Edited finding");
      await click(cancelButton());
      expect(reviewForm()).not.toBeNull();
      expect(container.textContent).toMatch(/discard your changes/i);
      expect(document.activeElement).toBe(keepEditingButton());

      await click(keepEditingButton());
      expect(discardButton()).toBeUndefined();
      expect(noteText().value).toBe("Edited finding");
      expect(document.activeElement).toBe(noteText());
    });

    it("asks before discarding on Escape and discards only when explicit", async () => {
      await render(withThread(workspace()));
      await click(reviewButton());
      await click(confirm());
      await pressEscape();
      expect(reviewForm()).not.toBeNull();
      expect(discardButton()).toBeDefined();

      await click(discardButton());
      expect(
        container.querySelector('form[aria-label="Review AI draft as note"]')
      ).toBeNull();
      expect(document.activeElement).toBe(reviewButton());

      await click(reviewButton());
      expect(noteText().value).toBe(
        "Assessments: possible: weak battery\n\nNEXT STEP: Measure resting battery voltage."
      );
    });

    function deferredSave() {
      let resolve!: (value: { status: "success"; error: null }) => void;
      promoteAssistantNoteAction.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        })
      );
      return () => resolve({ status: "success", error: null });
    }

    it("offers no way to cancel or discard while a save is in flight", async () => {
      const finishSave = deferredSave();
      await render(withThread(workspace()));
      await click(reviewButton());
      await setValue(noteText(), "Edited finding");
      await click(confirm());
      await act(async () => reviewForm().requestSubmit());

      expect(saveButton().textContent).toMatch(/saving/i);
      expect(cancelButton()?.disabled).toBe(true);
      await pressEscape();
      expect(reviewForm()).not.toBeNull();
      expect(discardButton()).toBeUndefined();
      expect(keepEditingButton()).toBeUndefined();

      await act(async () => finishSave());
      expect(promoteAssistantNoteAction).toHaveBeenCalledTimes(1);
      expect(
        container.querySelector('form[aria-label="Review AI draft as note"]')
      ).toBeNull();
      expect((document.activeElement as HTMLElement).textContent).toMatch(
        /saved as a technician note/i
      );
    });

    it("withdraws an open discard prompt once saving starts", async () => {
      const finishSave = deferredSave();
      await render(withThread(workspace()));
      await click(reviewButton());
      await click(confirm());
      await click(cancelButton());
      expect(discardButton()).toBeDefined();

      await act(async () => reviewForm().requestSubmit());
      expect(discardButton()).toBeUndefined();
      expect(keepEditingButton()).toBeUndefined();

      await act(async () => finishSave());
      expect(container.textContent).toMatch(/saved as a technician note/i);
    });

    it("moves focus to a stable saved status after saving, surviving the refresh", async () => {
      promoteAssistantNoteAction.mockResolvedValue({ status: "success", error: null });
      await render(withThread(workspace()));
      await click(reviewButton());
      await click(confirm());
      await act(async () => reviewForm().requestSubmit());

      const active = document.activeElement as HTMLElement;
      expect(active).not.toBe(document.body);
      expect(active.textContent).toMatch(/saved as a technician note/i);
      expect(active.getAttribute("tabindex")).toBe("-1");

      await render(
        withThread(
          workspace({}, [
            assistantMessage({ promotedNoteId: "c1111111-1111-4111-8111-111111111111" }),
          ])
        )
      );
      expect(document.activeElement).toBe(active);
      expect(active.isConnected).toBe(true);
    });

    it("closes with Cancel or Escape and returns focus to the review button", async () => {
      await render(withThread(workspace()));
      await click(reviewButton());
      await click(
        Array.from(reviewForm().querySelectorAll("button")).find((b) =>
          /cancel/i.test(b.textContent ?? "")
        )
      );
      expect(
        container.querySelector('form[aria-label="Review AI draft as note"]')
      ).toBeNull();
      expect(document.activeElement).toBe(reviewButton());

      await click(reviewButton());
      await act(async () => {
        noteText().dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
      });
      expect(
        container.querySelector('form[aria-label="Review AI draft as note"]')
      ).toBeNull();
      expect(document.activeElement).toBe(reviewButton());
    });

    it.each([
      ["advisor", { mode: "advisor" as const, audience: "front_office" as const }],
      ["intake", { mode: "intake" as const, audience: "front_office" as const }],
    ])(
      "is never offered for %s drafts, which are copy-only and never sent",
      async (_n, t) => {
        await render(withThread(workspace(t)));
        expect(reviewButton()).toBeUndefined();
        expect(buttonNamed(/copy ai draft/i)).toBeDefined();
        expect(container.textContent).toMatch(/nothing is sent/i);
      }
    );

    it.each([
      [
        "preview",
        {
          ...FULL_CAPS,
          canMutate: false,
          preview: true,
          lockReason: "preview",
          canPromoteNotes: false,
        },
      ],
      [
        "foreign",
        {
          ...FULL_CAPS,
          canMutate: false,
          readOnly: true,
          lockReason: "foreign",
          canPromoteNotes: false,
        },
      ],
      [
        "locked",
        {
          ...FULL_CAPS,
          canMutate: false,
          readOnly: true,
          lockReason: "locked",
          canPromoteNotes: false,
        },
      ],
      ["no note role", { ...FULL_CAPS, canPromoteNotes: false }],
    ] as const)("is not offered when %s", async (_name, capabilities) => {
      await render(
        withThread(workspace(), {
          capabilities: capabilities as PanelProps["capabilities"],
        })
      );
      expect(reviewButton()).toBeUndefined();
      expect(buttonNamed(/copy ai draft/i)).toBeDefined();
    });

    it("shows a reloaded promoted draft as saved instead of offering review again", async () => {
      const promoted = workspace({}, [
        assistantMessage({ promotedNoteId: "c1111111-1111-4111-8111-111111111111" }),
      ]);
      await render(withThread(promoted));
      expect(reviewButton()).toBeUndefined();
      expect(container.textContent).toMatch(/saved as a technician note/i);
      expect(buttonNamed(/copy ai draft/i)).toBeDefined();

      await render(
        withThread(promoted, {
          capabilities: { ...FULL_CAPS, canMutate: false, canPromoteNotes: false },
        })
      );
      expect(container.textContent).toMatch(/saved as a technician note/i);
    });

    it("is not offered on an archived thread or an unfinished draft", async () => {
      await render(withThread(workspace({ status: "archived" })));
      expect(reviewButton()).toBeUndefined();
      await render(
        withThread(
          workspace({ status: "generating" }, [
            assistantMessage({ generationStatus: "generating", body: null }),
          ])
        )
      );
      expect(reviewButton()).toBeUndefined();
    });
  });

  describe("no workflow side effects", () => {
    it("offers no send-to-customer, approve, order, complete, QC or release actions", async () => {
      for (const mode of ["shop", "teach", "report", "advisor", "intake"] as const) {
        await render(
          withThread(
            workspace({
              mode,
              audience:
                mode === "advisor" || mode === "intake" ? "front_office" : "technical",
            })
          )
        );
        const names = buttons().map(
          (b) => `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`
        );
        for (const name of names) {
          expect(name).not.toMatch(
            /approve|order|complete|quality|\bqc\b|release|customer|email/i
          );
        }
        const articleButtons = Array.from(
          container.querySelectorAll("article button")
        ).map((b) => b.textContent ?? "");
        expect(articleButtons.join(" ")).not.toMatch(/send/i);
      }
      expect(submitAssistantTurnAction).not.toHaveBeenCalled();
      expect(promoteAssistantNoteAction).not.toHaveBeenCalled();
      expect(createAssistantThreadAction).not.toHaveBeenCalled();
    });
  });

  describe("accessibility", () => {
    it("labels the panel, list, and new-conversation controls", async () => {
      await render(props({ threads: [listItem()] }));
      const section = container.querySelector<HTMLElement>("section[aria-labelledby]")!;
      const heading = document.getElementById(section.getAttribute("aria-labelledby")!);
      expect(heading?.textContent).toBe("Ask OTOMOTO");
      expect(nav()).not.toBeNull();
      for (const radio of modeRadios()) {
        expect(container.querySelector(`label[for="${radio.id}"]`)).not.toBeNull();
      }
      expect(createButton()?.getAttribute("type")).toBe("submit");
    });

    const headings = (root: ParentNode) =>
      Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(
        (node) => `${node.tagName}:${node.textContent?.trim()}`
      );

    it("nests office subheadings under the h2 panel heading", async () => {
      await render(props({ threads: [listItem()] }));
      expect(headings(container)).toEqual([
        "H2:Ask OTOMOTO",
        "H3:Conversations",
        "H3:Start a new conversation",
      ]);
      await render(withThread(workspace()));
      expect(headings(container)).toEqual([
        "H2:Ask OTOMOTO",
        "H3:Conversations",
        "H3:Ask OTOMOTO · Technician (/shop)",
        "H4:Photos for AI analysis",
      ]);
    });

    it("stays single-column until extra-wide screens", async () => {
      await render(withThread(workspace()));
      const layout = nav()!.parentElement!;
      expect(layout.className).toMatch(/\bxl:grid-cols-/);
      expect(layout.className).not.toMatch(/\b(sm|md|lg):grid-cols-/);
    });

    it("moves between modes with the keyboard as a native radio group", async () => {
      await render(props());
      const radios = modeRadios();
      expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
      radios[0].focus();
      expect(document.activeElement).toBe(radios[0]);
    });
  });

  describe("floor packet integration", () => {
    const packet = {
      work_order_id: WO,
      work_order_number: "WO-100",
      wo_status: "in_progress",
      wo_status_label: "In progress",
      motorcycle_label: "2026 Honda CB500F",
      jobs: [],
      pending_recommendations: [],
      notes: [],
    } as never;

    it("renders the shared panel in the packet with floor routes and the selected tab link", async () => {
      const floorRoute = {
        surface: "floor" as const,
        workOrderId: WO,
        jobId: JOB,
        stage: "work" as const,
      };
      await act(async () => {
        root.render(
          withPhotoQueue(
            React.createElement(JobPacketPanel, {
              packet,
              section: "assistant",
              closeHref: `/technician?wo=${WO}`,
              stage: "work",
              selectedJobId: JOB,
              assistant: withThread(workspace(), {
                route: floorRoute,
                jobs: [{ jobId: JOB, label: "Brake service" }],
                defaultJobId: JOB,
                capabilities: { ...FULL_CAPS, canUseFrontOfficeModes: false },
              }),
            })
          )
        );
      });

      const tab = container.querySelector<HTMLAnchorElement>(
        '[role="tab"][aria-selected="true"]'
      )!;
      expect(tab.textContent).toContain("Ask OTOMOTO");
      expect(new URL(tab.href).searchParams.get("assistantThread")).toBe(THREAD);
      const link = nav()!.querySelector("a")!;
      const url = new URL(link.getAttribute("href")!, "https://example.invalid");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        wo: WO,
        job: JOB,
        stage: "work",
        panel: "packet",
        packetSection: "assistant",
        assistantThread: THREAD,
      });
      expect(container.textContent).toContain("Measure resting battery voltage.");
      const panel = container.querySelector<HTMLElement>('[role="tabpanel"]')!;
      expect(
        Array.from(panel.querySelectorAll("h1, h2, h3, h4, h5, h6")).map(
          (node) => `${node.tagName}:${node.textContent?.trim()}`
        )
      ).toEqual([
        "H3:Ask OTOMOTO",
        "H4:Conversations",
        "H4:Ask OTOMOTO · Technician (/shop)",
        "H5:Photos for AI analysis",
      ]);
    });

    it("shows the new-conversation state in the packet when no thread is selected", async () => {
      await act(async () => {
        root.render(
          withPhotoQueue(
            React.createElement(JobPacketPanel, {
              packet,
              section: "assistant",
              closeHref: `/technician?wo=${WO}`,
              stage: "work",
              assistant: props({
                route: { surface: "floor", workOrderId: WO, jobId: null, stage: "work" },
                jobs: [],
                capabilities: { ...FULL_CAPS, canUseFrontOfficeModes: false },
              }),
            })
          )
        );
      });
      expect(createForm()).not.toBeNull();
      expect(container.textContent).not.toMatch(/unavailable/i);
      expect(createForm()!.querySelector("h4")?.textContent).toBe(
        "Start a new conversation"
      );
      expect(container.querySelector('[role="tabpanel"] h2')).toBeNull();
    });
  });
});
