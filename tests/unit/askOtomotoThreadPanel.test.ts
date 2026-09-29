// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  refresh,
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  uploadAssistantPhotoAction,
} = vi.hoisted(() => ({
  refresh: vi.fn(),
  retryAssistantTurnAction: vi.fn(),
  submitAssistantTurnAction: vi.fn(),
  uploadAssistantPhotoAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/app/(app)/work_orders/assistant-actions", () => ({
  retryAssistantTurnAction,
  submitAssistantTurnAction,
  uploadAssistantPhotoAction,
}));
vi.mock("@/app/(app)/work_orders/note-actions", () => ({
  addTechnicianNoteAction: vi.fn(),
}));

import { AskOtomotoThreadPanel } from "@/components/diagnostics/AskOtomotoThreadPanel";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import type { AssistantComposerFlags } from "@/lib/diagnostics/assistantPageState";
import type { AskOtomotoPanelData } from "@/lib/diagnostics/askOtomotoView";
import type { DiagnosticsPhotoSourceRow } from "@/lib/diagnostics/photoSelection";
import type {
  DiagnosticsMessageView,
  DiagnosticsThreadWorkspace,
} from "@/lib/services/diagnosticsAssistant";

const JOB = "51111111-1111-4111-8111-111111111111";
const WORK_ORDER = "41111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";

function packetAssistant(
  ws: DiagnosticsThreadWorkspace,
  overrides: Partial<AskOtomotoPanelData> = {}
): AskOtomotoPanelData {
  return {
    route: { surface: "floor", workOrderId: WORK_ORDER, jobId: null, stage: "work" },
    threads: [],
    selectedThreadId: ws.thread.threadId,
    workspace: ws,
    jobs: [],
    defaultJobId: null,
    photos: [],
    config: { configured: true, modelLabel: null, reason: null },
    capabilities: {
      canMutate: false,
      preview: false,
      readOnly: false,
      lockReason: "role",
      canUseFrontOfficeModes: false,
      canPromoteNotes: false,
    },
    ...overrides,
  };
}

function submitButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')
  );
}

function workspace(
  overrides: Partial<DiagnosticsThreadWorkspace["thread"]> = {}
): DiagnosticsThreadWorkspace {
  return {
    thread: {
      threadId: THREAD,
      workOrderId: WORK_ORDER,
      jobId: null,
      locationId: "31111111-1111-4111-8111-111111111111",
      mode: "shop",
      audience: "technical",
      status: "ready",
      diagnosticPhase: "diagnosis",
      triggerType: "inspection_completed",
      createdAt: "2026-09-29T00:00:00.000Z",
      updatedAt: "2026-09-29T00:00:00.000Z",
      ...overrides,
    },
    messages: [
      {
        messageId: "a1111111-1111-4111-8111-111111111111",
        threadId: THREAD,
        role: "assistant",
        body: "Inspect the battery terminals next.",
        generationStatus: "ready",
        requestedInput: null,
        phase: "diagnosis",
        safeErrorCode: null,
        parentUserMessageId: "b1111111-1111-4111-8111-111111111111",
        requestedProviderModel: "model",
        providerModel: "model",
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
        photos: [],
      },
    ],
  };
}

describe("AskOtomotoThreadPanel", () => {
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
  });

  it("shows the selected automatic thread, status, messages, and review label", async () => {
    await act(async () => {
      root.render(
        React.createElement(AskOtomotoThreadPanel, {
          workspace: workspace(),
        })
      );
    });

    expect(container.textContent).toContain("Ask OTOMOTO");
    expect(container.textContent).toContain("Technician (/shop)");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Automatic arrival-inspection review");
    expect(container.textContent).toContain("Staff review required");
    expect(container.textContent).toContain("Inspect the battery terminals next.");
  });

  it("shows refresh while pending and Retry only for failed threads", async () => {
    await act(async () => {
      root.render(
        React.createElement(AskOtomotoThreadPanel, {
          workspace: workspace({ status: "generating" }),
        })
      );
    });
    expect(container.textContent).toContain("Generating");
    expect(
      Array.from(container.querySelectorAll('button[type="button"]')).some((b) =>
        /^refresh$/i.test(b.textContent?.trim() ?? "")
      )
    ).toBe(true);
    expect(submitButtons().some((b) => /retry/i.test(b.textContent ?? ""))).toBe(false);

    await act(async () => {
      root.render(
        React.createElement(AskOtomotoThreadPanel, {
          workspace: workspace({ status: "failed" }),
          canMutate: true,
        })
      );
    });
    expect(container.textContent).toContain("Failed");
    expect(submitButtons().some((b) => /retry/i.test(b.textContent ?? ""))).toBe(true);
  });

  it("renders the exact selected workspace in the floor assistant packet", async () => {
    await act(async () => {
      root.render(
        React.createElement(JobPacketPanel, {
          packet: {
            work_order_id: WORK_ORDER,
            work_order_number: "WO-100",
            wo_status: "in_progress",
            wo_status_label: "In progress",
            motorcycle_label: "2026 Honda CB500F",
            jobs: [],
            pending_recommendations: [],
            notes: [],
          },
          section: "assistant",
          closeHref: `/technician?wo=${WORK_ORDER}`,
          stage: "work",
          assistant: packetAssistant(workspace()),
        })
      );
    });

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain("Ask OTOMOTO");
    expect(container.textContent).toContain("Inspect the battery terminals next.");
  });

  it("gives the floor packet composer only the separate sanitized assistant photos plus mutation flags", async () => {
    const packet = {
      work_order_id: WORK_ORDER,
      work_order_number: "WO-100",
      wo_status: "in_progress",
      wo_status_label: "In progress",
      motorcycle_label: "2026 Honda CB500F",
      jobs: [],
      pending_recommendations: [],
      notes: [],
    } as never;
    const row = (id: string, category: string, jobId: string | null) =>
      ({
        photo_id: id,
        work_order_id: WORK_ORDER,
        uploaded_by_user_id: null,
        storage_path: `${WORK_ORDER}/${category}/${id}.jpg`,
        thumb_storage_path: null,
        photo_url: null,
        category,
        notes: null,
        inspection_result_id: null,
        job_id: jobId,
        created_at: "2026-09-29T14:05:00.000Z",
        thumb_url: `https://signed.example/${id}.jpg`,
      }) as never;
    const render = async (flags: AssistantComposerFlags) => {
      await act(async () => {
        root.render(
          React.createElement(JobPacketPanel, {
            packet,
            section: "assistant",
            closeHref: `/technician?wo=${WORK_ORDER}`,
            stage: "work",
            assistant: packetAssistant(workspace({ jobId: JOB, triggerType: null }), {
              photos: [
                {
                  photo_id: "a1111111-1111-4111-8111-111111111111",
                  work_order_id: WORK_ORDER,
                  job_id: JOB,
                  category: "job_work",
                  created_at: "2026-09-29T14:05:00.000Z",
                  thumb_url: "https://signed.example/a1.jpg",
                },
              ],
              capabilities: {
                ...flags,
                lockReason: flags.preview ? "preview" : null,
                canUseFrontOfficeModes: false,
                canPromoteNotes: flags.canMutate,
              },
            }),
            photos: [
              row("a1111111-1111-4111-8111-111111111111", "job_work", JOB),
              row("a2222222-2222-4222-8222-222222222222", "vin", null),
              row("a3333333-3333-4333-8333-333333333333", "job_work", JOB),
            ],
          })
        );
      });
    };

    await render({ canMutate: true, preview: false, readOnly: false });
    const assistantThumbs = container.querySelectorAll(
      '[role="group"] button[aria-pressed]'
    );
    expect(assistantThumbs).toHaveLength(1);
    expect(container.querySelector("textarea")?.disabled).toBe(false);

    await render({ canMutate: false, preview: true, readOnly: false });
    expect(container.querySelector("textarea")?.disabled).toBe(true);
  });

  describe("interactive turn composer", () => {
    const PHOTO = "a1111111-1111-4111-8111-111111111111";
    const photos: DiagnosticsPhotoSourceRow[] = [
      {
        photo_id: PHOTO,
        work_order_id: WORK_ORDER,
        job_id: JOB,
        category: "job_work",
        created_at: "2026-09-29T14:05:00.000Z",
        thumb_url: "https://signed.example/thumb.jpg",
      },
      {
        photo_id: "a2222222-2222-4222-8222-222222222222",
        work_order_id: WORK_ORDER,
        job_id: null,
        category: "vin",
        created_at: "2026-09-29T14:05:00.000Z",
        thumb_url: "https://signed.example/vin.jpg",
      },
    ];

    async function renderThread(
      ws: DiagnosticsThreadWorkspace,
      props: Record<string, unknown> = {}
    ) {
      await act(async () => {
        root.render(
          React.createElement(AskOtomotoThreadPanel, {
            workspace: ws,
            photos,
            canMutate: true,
            ...props,
          })
        );
      });
    }

    const textarea = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
    const sendButton = () =>
      submitButtons().find((b) => /send/i.test(b.textContent ?? ""))!;
    const hidden = (name: string) =>
      container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);

    async function type(value: string) {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )!.set!;
        setter.call(textarea(), value);
        textarea().dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    function jobWorkspace(
      overrides: Partial<DiagnosticsThreadWorkspace["thread"]> = {},
      messages?: DiagnosticsMessageView[]
    ): DiagnosticsThreadWorkspace {
      const base = workspace({ jobId: JOB, triggerType: null, ...overrides });
      return messages ? { ...base, messages } : base;
    }

    it("renders a textarea, hidden exact thread/job/mode, and an empty photos payload", async () => {
      await renderThread(jobWorkspace());

      expect(textarea().disabled).toBe(false);
      expect(hidden("thread_id")?.value).toBe(THREAD);
      expect(hidden("job_id")?.value).toBe(JOB);
      expect(hidden("mode")?.value).toBe("shop");
      expect(hidden("photos")?.value).toBe("[]");
      expect(sendButton().disabled).toBe(true);
    });

    it("omits the job id for a work-order-only thread", async () => {
      await renderThread(workspace({ jobId: null }));
      expect(hidden("job_id")?.value ?? "").toBe("");
    });

    it("enables Send once there is text and disables it again when blank", async () => {
      await renderThread(jobWorkspace());
      await type("Check the battery terminals");
      expect(sendButton().disabled).toBe(false);
      await type("   ");
      expect(sendButton().disabled).toBe(true);
    });

    it.each([
      ["pending", { status: "pending" }, {}],
      ["generating", { status: "generating" }, {}],
      ["archived", { status: "archived" }, {}],
      ["readOnly", {}, { readOnly: true }],
      ["preview", {}, { preview: true }],
      ["canMutate=false", {}, { canMutate: false }],
    ])("disables the composer when %s", async (_name, threadOverrides, props) => {
      await renderThread(jobWorkspace(threadOverrides as never), props);
      expect(textarea().disabled).toBe(true);
      expect(sendButton().disabled).toBe(true);
      const fileInputs = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[type="file"]')
      );
      expect(fileInputs.every((input) => input.disabled)).toBe(true);
      expect(
        Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
          .filter((b) => /^(camera|library)$/i.test(b.textContent?.trim() ?? ""))
          .every((b) => b.disabled)
      ).toBe(true);
    });

    it("keeps the composer available and Retry visible on a failed thread", async () => {
      await renderThread(jobWorkspace({ status: "failed" }));
      expect(textarea().disabled).toBe(false);
      expect(submitButtons().some((b) => /retry/i.test(b.textContent ?? ""))).toBe(true);
    });

    it("puts exactly {photoId, purpose} in the hidden JSON for explicit selections only", async () => {
      await renderThread(jobWorkspace());
      expect(hidden("photos")?.value).toBe("[]");

      await act(async () => {
        container.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click();
      });

      const parsed = JSON.parse(hidden("photos")!.value);
      expect(parsed).toEqual([{ photoId: PHOTO, purpose: "Work photo for analysis" }]);
      expect(hidden("photos")!.value).not.toMatch(/https?:|blob:|storage|thumb/);
      expect(container.querySelectorAll("button[aria-pressed]")).toHaveLength(1);
    });

    it("blocks Send while a selected photo has a blank purpose", async () => {
      await renderThread(jobWorkspace());
      await type("What does this show?");
      await act(async () => {
        container.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click();
      });
      expect(sendButton().disabled).toBe(false);

      await act(async () => {
        const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          "  "
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(sendButton().disabled).toBe(true);
      expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
        /describe what photo 1/i
      );
    });

    it("submits the turn action, then clears the composer and refreshes on success", async () => {
      submitAssistantTurnAction.mockResolvedValue({
        status: "success",
        error: null,
        data: {},
      });
      await renderThread(jobWorkspace());
      await type("Battery reads 12.1 V");
      await act(async () => {
        container.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click();
      });

      await act(async () => {
        container.querySelector("form")!.requestSubmit();
      });

      expect(submitAssistantTurnAction).toHaveBeenCalledTimes(1);
      const [workOrderId, , form] = submitAssistantTurnAction.mock.calls[0] as [
        string,
        unknown,
        FormData,
      ];
      expect(workOrderId).toBe(WORK_ORDER);
      expect(form.get("thread_id")).toBe(THREAD);
      expect(form.get("job_id")).toBe(JOB);
      expect(form.get("mode")).toBe("shop");
      expect(form.get("text")).toBe("Battery reads 12.1 V");
      expect(JSON.parse(String(form.get("photos")))).toEqual([
        { photoId: PHOTO, purpose: "Work photo for analysis" },
      ]);
      expect(refresh).toHaveBeenCalled();
      expect(textarea().value).toBe("");
      expect(hidden("photos")?.value).toBe("[]");
    });

    it("keeps the text and shows the error when the turn fails", async () => {
      submitAssistantTurnAction.mockResolvedValue({
        status: "error",
        error: "Ask OTOMOTO is receiving too many requests.",
      });
      await renderThread(jobWorkspace());
      await type("Try again please");
      await act(async () => {
        container.querySelector("form")!.requestSubmit();
      });

      expect(refresh).not.toHaveBeenCalled();
      expect(textarea().value).toBe("Try again please");
      expect(container.textContent).toContain("too many requests");
    });

    it("focuses the photo picker for a photo request but leaves other inputs to the text box", async () => {
      const assistant = (requestedInput: unknown): DiagnosticsMessageView => ({
        ...workspace().messages[0],
        requestedInput,
      });
      await renderThread(
        jobWorkspace({}, [
          assistant({
            type: "photo",
            prompt: "Photograph the left caliper piston",
            purpose: null,
            tool_placement: null,
            conditions: null,
            units: null,
          }),
        ])
      );
      const region = container.querySelector('[role="group"]');
      expect(document.activeElement).toBe(region);
      expect(container.textContent).toContain("Photograph the left caliper piston");

      await act(async () => {
        container.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click();
      });
      expect(container.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe(
        "Photograph the left caliper piston"
      );

      (document.activeElement as HTMLElement | null)?.blur();
      await renderThread(
        jobWorkspace({}, [
          assistant({
            type: "measurement",
            prompt: "Measure battery voltage",
            purpose: null,
            tool_placement: null,
            conditions: null,
            units: "V",
          }),
        ])
      );
      expect(container.textContent).not.toContain("Photo requested");
    });

    it("shows attached message photos as evidence chips without inference and never renders HTML", async () => {
      const userMessage: DiagnosticsMessageView = {
        ...workspace().messages[0],
        messageId: "c1111111-1111-4111-8111-111111111111",
        role: "user",
        body: "<img src=x onerror=alert(1)> please look",
        photos: [
          {
            photoId: PHOTO,
            category: "job_work",
            notes: "Customer Jane Doe",
            purpose: "Pad wear",
            sortOrder: 0,
            createdAt: "2026-09-29T14:05:00.000Z",
          },
        ],
      };
      await renderThread(jobWorkspace({}, [userMessage]), { canMutate: false });

      const chips = container.querySelector('[aria-label="Attached photos"]');
      expect(chips?.textContent).toContain("Work photo");
      expect(chips?.textContent).toContain("Pad wear");
      expect(chips?.textContent).not.toContain("Jane");
      expect(container.querySelector("img[src='x']")).toBeNull();
      expect(container.textContent).toContain("<img src=x onerror=alert(1)> please look");
      expect(container.textContent).toContain("Staff review required");
    });
  });

  describe("send/retry gating and lifecycle", () => {
    const failedWs = () => workspace({ jobId: JOB, triggerType: null, status: "failed" });

    async function mount(
      ws: DiagnosticsThreadWorkspace,
      props: Record<string, unknown> = {}
    ) {
      await act(async () => {
        root.render(
          React.createElement(AskOtomotoThreadPanel, {
            workspace: ws,
            photos: [],
            canMutate: true,
            ...props,
          })
        );
      });
    }
    const ta = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
    const send = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        /^(send|sending)/i.test(b.textContent?.trim() ?? "")
      )!;
    const retry = () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
        /^retry/i.test(b.textContent?.trim() ?? "")
      );
    async function typeText(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )!.set!.call(ta(), value);
        ta().dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }
    const forms = () => Array.from(container.querySelectorAll("form"));

    it.each([
      ["readOnly", { readOnly: true }],
      ["preview", { preview: true }],
      ["canMutate=false", { canMutate: false }],
    ])("hides Retry on a failed thread when %s", async (_name, props) => {
      await mount(failedWs(), props);
      expect(retry()).toBeUndefined();
      expect(container.textContent).toContain("Generation failed");
    });

    describe("failed response text", () => {
      const failedMessage = (): DiagnosticsMessageView => ({
        ...workspace().messages[0],
        body: null,
        generationStatus: "failed",
        safeErrorCode: "DIAGNOSTICS_AI_PROVIDER_FAILED",
      });
      const failedWithMessage = (): DiagnosticsThreadWorkspace => ({
        ...failedWs(),
        messages: [failedMessage()],
      });

      it("tells staff to use Retry only when Retry is available", async () => {
        await mount(failedWithMessage());
        expect(container.textContent).toContain("use Retry");
        expect(retry()).toBeDefined();
      });

      it.each([
        ["readOnly", { readOnly: true }, /read-only/i],
        ["preview", { preview: true }, /read-only/i],
        ["canMutate=false", { canMutate: false }, /unavailable/i],
      ])("does not point at a hidden Retry when %s", async (_name, props, wording) => {
        await mount(failedWithMessage(), props);
        expect(retry()).toBeUndefined();
        expect(container.textContent).not.toMatch(/retry/i);
        expect(container.textContent).toMatch(wording);
      });
    });

    it("shows Retry on a failed thread when mutation is allowed", async () => {
      await mount(failedWs());
      expect(retry()?.disabled).toBe(false);
    });

    it("ignores duplicate submits while a send is in flight and blocks Retry meanwhile", async () => {
      const gate = deferred<unknown>();
      submitAssistantTurnAction.mockReturnValue(gate.promise);
      await mount(failedWs());
      await typeText("Check the battery");

      await act(async () => {
        forms()[0].requestSubmit();
      });
      await act(async () => {
        forms()[0].requestSubmit();
      });

      expect(submitAssistantTurnAction).toHaveBeenCalledTimes(1);
      expect(send().disabled).toBe(true);
      expect(retry()?.disabled).toBe(true);
      await act(async () => {
        forms()[1].requestSubmit();
      });
      expect(retryAssistantTurnAction).not.toHaveBeenCalled();

      await act(async () => gate.resolve({ status: "success", error: null }));
      expect(retry()?.disabled).toBe(false);
    });

    it("runs a send once even when submitted twice in the same tick", async () => {
      const gate = deferred<unknown>();
      submitAssistantTurnAction.mockReturnValue(gate.promise);
      await mount(failedWs());
      await typeText("Check the battery");
      await act(async () => {
        forms()[0].requestSubmit();
        forms()[0].requestSubmit();
      });
      expect(submitAssistantTurnAction).toHaveBeenCalledTimes(1);
      await act(async () => gate.resolve({ status: "success", error: null }));
    });

    it("runs a retry once even when submitted twice in the same tick", async () => {
      const gate = deferred<unknown>();
      retryAssistantTurnAction.mockReturnValue(gate.promise);
      await mount(failedWs());
      await act(async () => {
        forms()[1].requestSubmit();
        forms()[1].requestSubmit();
      });
      expect(retryAssistantTurnAction).toHaveBeenCalledTimes(1);
      await act(async () => gate.resolve({ status: "success", error: null }));
    });

    it("blocks Send while a Retry is in flight and ignores duplicate Retry submits", async () => {
      const gate = deferred<unknown>();
      retryAssistantTurnAction.mockReturnValue(gate.promise);
      await mount(failedWs());
      await typeText("Check the battery");
      expect(send().disabled).toBe(false);

      await act(async () => {
        forms()[1].requestSubmit();
      });
      await act(async () => {
        forms()[1].requestSubmit();
      });

      expect(retryAssistantTurnAction).toHaveBeenCalledTimes(1);
      expect(send().disabled).toBe(true);
      expect(ta().disabled).toBe(true);
      await act(async () => {
        forms()[0].requestSubmit();
      });
      expect(submitAssistantTurnAction).not.toHaveBeenCalled();

      await act(async () => gate.resolve({ status: "success", error: null }));
      expect(send().disabled).toBe(false);
    });

    it("does not call the action for a blank message even if the form is submitted directly", async () => {
      await mount(workspace({ jobId: JOB, triggerType: null }));
      await act(async () => {
        forms()[0].requestSubmit();
      });
      expect(submitAssistantTurnAction).not.toHaveBeenCalled();
    });

    it("returns focus to the message box after a failed send instead of the photo picker", async () => {
      submitAssistantTurnAction.mockResolvedValue({
        status: "error",
        error: "Ask OTOMOTO is temporarily unavailable.",
      });
      const request = {
        ...workspace().messages[0],
        requestedInput: {
          type: "photo",
          prompt: "Show the caliper",
          purpose: null,
          tool_placement: null,
          conditions: null,
          units: null,
        },
      };
      await mount({
        ...workspace({ jobId: JOB, triggerType: null }),
        messages: [request],
      });
      expect(document.activeElement).toBe(container.querySelector('[role="group"]'));

      await typeText("Here is the answer");
      ta().focus();
      await act(async () => {
        forms()[0].requestSubmit();
      });

      expect(container.textContent).toContain("temporarily unavailable");
      expect(document.activeElement).toBe(ta());
    });

    it("allows the first send on a new manual pending thread with no messages", async () => {
      await mount({
        ...workspace({ jobId: JOB, triggerType: null, status: "pending" }),
        messages: [],
      });
      expect(ta().disabled).toBe(false);
      await typeText("First question");
      expect(send().disabled).toBe(false);
      expect(container.textContent).not.toContain("Pending automatic review");
    });

    it.each([
      [
        "automatic pending trigger",
        { triggerType: "inspection_completed", status: "pending" },
        [],
      ],
      [
        "automatic pending job trigger",
        { triggerType: "job_completed", status: "pending" },
        [],
      ],
      [
        "manual pending with messages",
        { triggerType: null, status: "pending" },
        "messages",
      ],
      ["manual generating", { triggerType: null, status: "generating" }, []],
      [
        "automatic generating",
        { triggerType: "inspection_completed", status: "generating" },
        [],
      ],
    ])("keeps the composer locked for %s", async (_name, overrides, messages) => {
      const base = workspace({ jobId: JOB, ...overrides } as never);
      await mount(messages === "messages" ? base : { ...base, messages: [] });
      expect(ta().disabled).toBe(true);
      expect(send().disabled).toBe(true);
    });
  });
});
