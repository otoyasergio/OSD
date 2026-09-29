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

import { DiagnosticsThreadReadOnly } from "@/components/diagnostics/DiagnosticsThreadReadOnly";
import { JobPacketPanel } from "@/components/technician/JobPacketPanel";
import type { AssistantComposerFlags } from "@/lib/diagnostics/assistantPageState";
import type { DiagnosticsPhotoSourceRow } from "@/lib/diagnostics/photoSelection";
import type {
  DiagnosticsMessageView,
  DiagnosticsThreadWorkspace,
} from "@/lib/services/diagnosticsAssistant";

const JOB = "51111111-1111-4111-8111-111111111111";
const WORK_ORDER = "41111111-1111-4111-8111-111111111111";
const THREAD = "71111111-1111-4111-8111-111111111111";

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

describe("DiagnosticsThreadReadOnly", () => {
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
        React.createElement(DiagnosticsThreadReadOnly, {
          workspace: workspace(),
        })
      );
    });

    expect(container.textContent).toContain("Ask OTOMOTO");
    expect(container.textContent).toContain("Shop");
    expect(container.textContent).toContain("Ready");
    expect(container.textContent).toContain("Automatic arrival-inspection review");
    expect(container.textContent).toContain("Staff review required");
    expect(container.textContent).toContain("Inspect the battery terminals next.");
  });

  it("shows refresh while pending and Retry only for failed threads", async () => {
    await act(async () => {
      root.render(
        React.createElement(DiagnosticsThreadReadOnly, {
          workspace: workspace({ status: "generating" }),
        })
      );
    });
    expect(container.textContent).toContain("Generating");
    expect(container.querySelector('button[type="button"]')?.textContent).toMatch(
      /refresh/i
    );
    expect(submitButtons().some((b) => /retry/i.test(b.textContent ?? ""))).toBe(false);

    await act(async () => {
      root.render(
        React.createElement(DiagnosticsThreadReadOnly, {
          workspace: workspace({ status: "failed" }),
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
          assistantWorkspace: workspace(),
        })
      );
    });

    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain("Ask OTOMOTO");
    expect(container.textContent).toContain("Inspect the battery terminals next.");
  });

  it("passes only eligible thread photos and the mutation flags into the floor packet composer", async () => {
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
            assistantWorkspace: workspace({ jobId: JOB, triggerType: null }),
            photos: [
              row("a1111111-1111-4111-8111-111111111111", "job_work", JOB),
              row("a2222222-2222-4222-8222-222222222222", "vin", null),
            ],
            assistantFlags: flags,
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
          React.createElement(DiagnosticsThreadReadOnly, {
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
      expect(container.querySelector('input[type="file"]')).toBeNull();
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
});
