# Inline Inspection Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a technician review and save the recommendation linked to an inspection finding in a modal without leaving or resetting the inspection checklist.

**Architecture:** Keep the existing automatic recommendation creation when a result becomes Future or Now. Change the inspection-result save path to update that linked pending recommendation idempotently, then add a focused portal modal controlled by `InspectionChecklist`; no route navigation occurs.

**Tech Stack:** Next.js 16 server actions, React 19 client components and `useActionState`, TypeScript, Supabase/Postgres, Vitest with jsdom.

## Global Constraints

- Future and Now statuses must continue auto-creating linked pending recommendations.
- Modal save updates the linked pending recommendation; it must not create a duplicate.
- The inspection page, scroll position, and local checklist state must remain mounted.
- This flow must not approve a recommendation, create an approved job, or add work to the technician docket.
- Add no dependency and no database migration.
- Preserve all unrelated working-tree changes.
- Do not commit or push unless the user explicitly requests it.

## Approved implementation amendment

Final review identified that an atomic “create if missing” fallback would require
a database uniqueness/transaction migration. The user selected the no-migration
path. This amendment supersedes any fallback-create snippets later in this
historical task plan:

- Modal saves update only the automatically created linked pending
  recommendation.
- Missing, void, acted-on, converted, or non-Future/Now findings return mapped
  recovery guidance and never create a replacement from the modal.
- Draft load and save verify the inspection result belongs to the exact supplied
  work order and enforce floor-technician assignment visibility.
- Expected draft-load failures cross the Server Action boundary as serializable
  `{ draft, error }` results so production does not redact the guidance.
- The completed implementation includes stateful service tests for ownership,
  assignment, missing rows, stale statuses, and guarded legacy/V2 update races.

---

### Task 1: Idempotent inspection-recommendation save

**Files:**

- Modify: `tests/unit/inspectionRecommendations.test.ts`
- Create: `tests/unit/recommendationActions.test.ts`
- Modify: `lib/services/recommendations.ts`
- Modify: `lib/services/errors.ts`
- Modify: `app/(app)/work_orders/recommendation-actions.ts`

**Interfaces:**

- Produces: `planInspectionRecommendationSave(existing): "create" | "update" | "blocked"`
- Produces: `saveRecommendationFromInspectionResult(inspectionResultId, input): Promise<Recommendation>`
- Produces: `saveInspectionRecommendationAction(workOrderId, inspectionResultId, state, formData)`
- Produces: `RecommendationFormState.saved?: boolean`, consumed by the modal in Task 2.

- [ ] **Step 1: Write failing save-planner tests**

Add `planInspectionRecommendationSave` to the existing named import from
`@/lib/services/recommendations`, then add this test block:

```ts
describe("inspection recommendation editor save", () => {
  it("updates the existing untouched pending recommendation", () => {
    expect(
      planInspectionRecommendationSave({
        status: "pending",
        converted_job_id: null,
        disposition: "open",
      })
    ).toBe("update");
  });

  it("creates only when no live linked recommendation exists", () => {
    expect(planInspectionRecommendationSave(null)).toBe("create");
    expect(
      planInspectionRecommendationSave({
        status: "pending",
        converted_job_id: null,
        disposition: "void",
      })
    ).toBe("create");
  });

  it("blocks edits after staff or customer action", () => {
    expect(
      planInspectionRecommendationSave({
        status: "deferred",
        converted_job_id: null,
        disposition: "deferred",
      })
    ).toBe("blocked");
    expect(
      planInspectionRecommendationSave({
        status: "converted_to_job",
        converted_job_id: "job-1",
        disposition: "scheduled",
      })
    ).toBe("blocked");
    expect(
      planInspectionRecommendationSave({
        status: "pending",
        converted_job_id: null,
        disposition: "declined",
      })
    ).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run the planner test and verify RED**

Run:

```bash
npm test -- tests/unit/inspectionRecommendations.test.ts
```

Expected: FAIL because `planInspectionRecommendationSave` is not exported.

- [ ] **Step 3: Add the save planner**

Add beside the existing recommendation sync planners in
`lib/services/recommendations.ts`:

```ts
export type InspectionRecommendationSavePlan = "create" | "update" | "blocked";

export function planInspectionRecommendationSave(
  existing:
    | (Pick<Recommendation, "status" | "converted_job_id"> & {
        disposition?: RecommendationDisposition | null;
      })
    | null
): InspectionRecommendationSavePlan {
  if (!existing || existing.disposition === "void") return "create";
  const dispositionOpen = existing.disposition == null || existing.disposition === "open";
  if (existing.status === "pending" && !existing.converted_job_id && dispositionOpen) {
    return "update";
  }
  return "blocked";
}
```

- [ ] **Step 4: Run the planner test and verify GREEN**

Run:

```bash
npm test -- tests/unit/inspectionRecommendations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Replace create-only inspection-result behavior with save behavior**

Rename `createRecommendationFromInspectionResult` to
`saveRecommendationFromInspectionResult` and replace its implementation with:

```ts
export async function saveRecommendationFromInspectionResult(
  inspectionResultId: string,
  input: {
    description?: string;
    severity?: RecommendationSeverity;
    notes?: string | null;
  } = {}
): Promise<Recommendation> {
  const user = await requireUser();
  if (!canCreateRecommendation(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: result, error } = await supabase
    .from("inspection_result")
    .select(
      `
      inspection_result_id,
      item_name_snapshot,
      category_snapshot,
      status,
      notes,
      inspection:inspection_id ( work_order_id )
    `
    )
    .eq("inspection_result_id", inspectionResultId)
    .maybeSingle();

  if (error) throw error;
  if (!result) throw new Error("INSPECTION_RESULT_NOT_FOUND");

  const inspection = result.inspection as unknown as {
    work_order_id: string;
  } | null;
  if (!inspection) throw new Error("INSPECTION_NOT_FOUND");

  const parsed = recommendationSchema.parse({
    description:
      input.description?.trim() ||
      `${result.item_name_snapshot} (${result.category_snapshot})`,
    severity:
      input.severity ??
      severityFromInspectionStatus(result.status as InspectionResultStatus | null),
    notes: input.notes ?? result.notes,
    inspection_result_id: inspectionResultId,
  });

  const access = await requireMutableWorkOrder(user, inspection.work_order_id);
  const existing = await loadLinkedRecommendation(
    access.supabase,
    inspection.work_order_id,
    inspectionResultId
  );
  const plan = planInspectionRecommendationSave(existing);

  if (plan === "blocked") {
    throw new Error("RECOMMENDATION_ALREADY_ACTIONED");
  }
  if (plan === "create") {
    return createRecommendation(inspection.work_order_id, parsed);
  }

  const { data: updated, error: updateError } = await access.supabase
    .from("recommendation")
    .update({
      description: parsed.description,
      severity: parsed.severity,
      notes: parsed.notes ?? null,
    })
    .eq("recommendation_id", existing!.recommendation_id)
    .eq("status", "pending")
    .is("converted_job_id", null)
    .select(COLUMNS)
    .maybeSingle();

  if (updateError) throw updateError;
  if (!updated) throw new Error("RECOMMENDATION_ALREADY_ACTIONED");

  await addAuditLog(access.supabase, {
    actor_user_id: user.user_id,
    location_id: access.locationId,
    action: "recommendation_updated",
    entity_type: "recommendation",
    entity_id: existing!.recommendation_id,
    description: `Recommendation updated on ${access.workOrderNumber}`,
    old_value: {
      description: existing!.description,
      severity: existing!.severity,
      notes: existing!.notes,
    },
    new_value: {
      description: parsed.description,
      severity: parsed.severity,
      notes: parsed.notes ?? null,
    },
  });

  return updated as Recommendation;
}
```

Keep `createRecommendation` unchanged so all create-side audit and timeline
behavior remains centralized.

- [ ] **Step 6: Write the failing dedicated-action test**

Create `tests/unit/recommendationActions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("@/lib/services/recommendations", () => ({
  approveRecommendationAndSendToFloor: vi.fn(),
  convertRecommendationToJob: vi.fn(),
  createRecommendation: vi.fn(),
  listOutstandingRecommendationsForMotorcycle: vi.fn(),
  saveRecommendationFromInspectionResult: mocks.save,
  updateRecommendationStatus: vi.fn(),
}));

import { saveInspectionRecommendationAction } from "@/app/(app)/work_orders/recommendation-actions";

describe("saveInspectionRecommendationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the linked inspection recommendation and reports success", async () => {
    mocks.save.mockResolvedValue({ recommendation_id: "recommendation-1" });
    const formData = new FormData();
    formData.set("description", "Front brake pads");
    formData.set("severity", "immediate_attention");
    formData.set("notes", "Replace now");

    const result = await saveInspectionRecommendationAction(
      "work-order-1",
      "inspection-result-1",
      { error: null },
      formData
    );

    expect(mocks.save).toHaveBeenCalledWith("inspection-result-1", {
      description: "Front brake pads",
      severity: "immediate_attention",
      notes: "Replace now",
    });
    expect(result).toEqual({ error: null, saved: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/work_orders/work-order-1/inspection"
    );
  });

  it("keeps the modal open when the recommendation was already acted on", async () => {
    mocks.save.mockRejectedValue(new Error("RECOMMENDATION_ALREADY_ACTIONED"));

    const result = await saveInspectionRecommendationAction(
      "work-order-1",
      "inspection-result-1",
      { error: null },
      new FormData()
    );

    expect(result).toEqual({
      error: "This recommendation has already been acted on and can no longer be edited.",
      saved: false,
    });
  });
});
```

- [ ] **Step 7: Run the action test and verify RED**

```bash
npm test -- tests/unit/recommendationActions.test.ts
```

Expected: FAIL because
`saveInspectionRecommendationAction` is not exported.

- [ ] **Step 8: Implement the dedicated action and error copy**

In `app/(app)/work_orders/recommendation-actions.ts`, import
`saveRecommendationFromInspectionResult` in place of
`createRecommendationFromInspectionResult`. Keep the existing
`createRecommendationAction` branch structure, but call the renamed save
service when `fromResult` is present. Then extend the shared state and add the
dedicated modal action:

```ts
export type RecommendationFormState = {
  error: string | null;
  saved?: boolean;
};

// Existing createRecommendationAction, inside `if (fromResult)`:
await saveRecommendationFromInspectionResult(fromResult, {
  description: String(formData.get("description") ?? "").trim() || undefined,
  severity: severityRaw ? (severityRaw as RecommendationSeverity) : undefined,
  notes: String(formData.get("notes") ?? "").trim() || null,
});

export async function saveInspectionRecommendationAction(
  workOrderId: string,
  inspectionResultId: string,
  _prevState: RecommendationFormState,
  formData: FormData
): Promise<RecommendationFormState> {
  try {
    const severityRaw = String(formData.get("severity") ?? "").trim();
    await saveRecommendationFromInspectionResult(inspectionResultId, {
      description: String(formData.get("description") ?? "").trim() || undefined,
      severity: severityRaw ? (severityRaw as RecommendationSeverity) : undefined,
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
  } catch (error) {
    return { error: toFormErrorMessage(error), saved: false };
  }

  revalidateRecommendations(workOrderId);
  return { error: null, saved: true };
}
```

The Work Order tab remains visually unchanged, while its inspection-result
deep-link path now also avoids duplicates.

Add to `MESSAGES` in `lib/services/errors.ts`:

```ts
RECOMMENDATION_ALREADY_ACTIONED:
  "This recommendation has already been acted on and can no longer be edited.",
```

- [ ] **Step 9: Run action tests and verify GREEN**

```bash
npm test -- tests/unit/recommendationActions.test.ts
```

Expected: PASS.

- [ ] **Step 10: Verify backend behavior**

Run:

```bash
npm test -- \
  tests/unit/inspectionRecommendations.test.ts \
  tests/unit/recommendationActions.test.ts \
  tests/unit/errors.test.ts
npm run typecheck
```

Expected: all three test files pass and TypeScript exits 0.

---

### Task 2: Accessible in-place recommendation modal

**Files:**

- Create: `components/inspections/InspectionRecommendationModal.tsx`
- Create: `tests/unit/inspectionRecommendationModal.test.tsx`

**Interfaces:**

- Consumes: `RecommendationFormState.saved` from Task 1.
- Consumes: a bound `saveInspectionRecommendationAction`.
- Produces: `onSaved()` and `onClose()` callbacks consumed by `InspectionChecklist`.

- [ ] **Step 1: Write failing modal interaction tests**

Create `tests/unit/inspectionRecommendationModal.test.tsx` with jsdom mounting
helpers following `tests/unit/staffNotifications.test.ts`. The core assertions
must be:

```tsx
/** @vitest-environment jsdom */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectionRecommendationModal } from "@/components/inspections/InspectionRecommendationModal";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = "";
  root = null;
  container = null;
  vi.clearAllMocks();
});

const result = {
  inspection_result_id: "10000000-0000-4000-8000-000000000001",
  inspection_id: "10000000-0000-4000-8000-000000000002",
  template_item_id: "10000000-0000-4000-8000-000000000003",
  category_snapshot: "Brakes & Tires",
  item_name_snapshot: "Front brake lining",
  display_order_snapshot: 1,
  requires_measurement_snapshot: true,
  status: "immediate_attention" as const,
  measurement: "1",
  notes: "Pads nearly worn",
  updated_by_user_id: null,
  updated_at: "2026-08-21T12:00:00.000Z",
};

it("prefills the selected finding and closes only after a successful save", async () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const action = vi.fn(async () => ({ error: null, saved: true }));

  mount(
    <InspectionRecommendationModal
      result={result}
      action={action}
      onClose={onClose}
      onSaved={onSaved}
    />
  );

  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    (document.querySelector('[name="description"]') as HTMLInputElement).value
  ).toContain("Front brake lining");
  expect((document.querySelector('[name="severity"]') as HTMLSelectElement).value).toBe(
    "immediate_attention"
  );
  expect((document.querySelector('[name="notes"]') as HTMLTextAreaElement).value).toBe(
    "Pads nearly worn"
  );

  await act(async () => {
    (document.querySelector("form") as HTMLFormElement).requestSubmit();
  });

  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the dialog open when save returns an error", async () => {
  const action = vi.fn(async () => ({
    error: "Could not save recommendation.",
    saved: false,
  }));

  mount(
    <InspectionRecommendationModal
      result={result}
      action={action}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );

  await act(async () => {
    (document.querySelector("form") as HTMLFormElement).requestSubmit();
  });

  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Could not save recommendation.");
});
```

- [ ] **Step 2: Run the modal test and verify RED**

Run:

```bash
npm test -- tests/unit/inspectionRecommendationModal.test.tsx
```

Expected: FAIL because `InspectionRecommendationModal` does not exist.

- [ ] **Step 3: Implement the modal**

Create `components/inspections/InspectionRecommendationModal.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { InspectionResultRow } from "@/lib/services/inspections";
import type { RecommendationFormState } from "@/app/(app)/work_orders/recommendation-actions";
import {
  FormError,
  SELECT_CLASS,
  TextAreaField,
  TextField,
} from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { RECOMMENDATION_SEVERITY_LABELS } from "@/lib/status/labels";

type Action = (
  state: RecommendationFormState,
  formData: FormData
) => Promise<RecommendationFormState>;

const SEVERITIES = [
  "future_attention",
  "immediate_attention",
  "safety_critical",
] as const;

export function InspectionRecommendationModal({
  result,
  action,
  onClose,
  onSaved,
}: {
  result: InspectionResultRow;
  action: Action;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {
    error: null,
    saved: false,
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!state.saved) return;
    onSaved();
    onClose();
  }, [state.saved, onClose, onSaved]);

  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreFocusTo.current instanceof HTMLElement) {
        restoreFocusTo.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, pending]);

  const defaultSeverity =
    result.status === "immediate_attention" ? "immediate_attention" : "future_attention";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspection-recommendation-title"
        tabIndex={-1}
        className="w-full max-w-xl rounded-xl bg-white p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2
            id="inspection-recommendation-title"
            className="text-lg font-semibold text-foreground"
          >
            Recommendation
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn btn-secondary"
            aria-label="Close recommendation"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <FormError message={state.error} />
          <TextField
            label="Description"
            name="description"
            required
            defaultValue={`${result.item_name_snapshot} (${result.category_snapshot})`}
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Severity
            </span>
            <select
              name="severity"
              required
              defaultValue={defaultSeverity}
              className={SELECT_CLASS}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {RECOMMENDATION_SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
          </label>
          <TextAreaField
            label="Notes"
            name="notes"
            rows={3}
            defaultValue={result.notes ?? ""}
          />
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <SubmitButton label="Save recommendation" pendingLabel="Saving…" />
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 4: Run modal tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/inspectionRecommendationModal.test.tsx
```

Expected: PASS.

---

### Task 3: Keep the inspection checklist mounted

**Files:**

- Modify: `components/inspections/InspectionItemRow.tsx`
- Modify: `components/inspections/InspectionChecklist.tsx`
- Modify: `tests/unit/inspectionRecommendationModal.test.tsx`

**Interfaces:**

- Consumes: `InspectionRecommendationModal` from Task 2.
- Produces: a row-level `Recommendation saved` confirmation.

- [ ] **Step 1: Add a failing checklist integration test**

At the top of `tests/unit/inspectionRecommendationModal.test.tsx`, add the
hoisted action mocks before importing `InspectionChecklist`:

```tsx
import type { InspectionDetail } from "@/lib/services/inspections";

const serverActions = vi.hoisted(() => ({
  saveRecommendation: vi.fn(),
  saveInspectionResult: vi.fn(),
  completeInspection: vi.fn(),
}));

vi.mock("@/app/(app)/work_orders/recommendation-actions", () => ({
  saveInspectionRecommendationAction: serverActions.saveRecommendation,
}));
vi.mock("@/app/(app)/work_orders/[work_order_id]/inspection/actions", () => ({
  saveInspectionResultAction: serverActions.saveInspectionResult,
  completeInspectionAction: serverActions.completeInspection,
}));
vi.mock("@/components/inspections/InspectionPhotoSlot", () => ({
  InspectionPhotoSlot: () => null,
}));

import { InspectionChecklist } from "@/components/inspections/InspectionChecklist";

const inspection: InspectionDetail = {
  inspection_id: "10000000-0000-4000-8000-000000000002",
  work_order_id: "10000000-0000-4000-8000-000000000004",
  started_at: "2026-08-21T12:00:00.000Z",
  completed_at: null,
  completed_by_user_id: null,
  location_id: "10000000-0000-4000-8000-000000000005",
  work_order_number: "WO-100",
  work_order_status: "in_progress",
  is_foreign_location: false,
  header: {
    customer_name: "Test Rider",
    motorcycle_label: "2024 Honda CB650R",
    vin: null,
    mileage: 1000,
    mileage_unit: "km",
    technician_name: "Test Tech",
    date_created: "2026-08-21T12:00:00.000Z",
  },
  results: [{ ...result, status: "future_attention" }],
  incomplete_count: 0,
  missing_photos: [],
  photos: [],
};

it("opens and saves a recommendation without leaving the inspection", async () => {
  serverActions.saveRecommendation.mockResolvedValue({
    error: null,
    saved: true,
  });
  serverActions.saveInspectionResult.mockResolvedValue({ ok: true });
  serverActions.completeInspection.mockResolvedValue({ error: null });
  const locationBefore = window.location.href;

  mount(
    <InspectionChecklist
      inspection={inspection}
      canEdit
      canForceComplete={false}
      canRecommend
    />
  );

  const openButton = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Create recommendation"
  )!;
  act(() => openButton.click());

  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(window.location.href).toBe(locationBefore);

  await act(async () => {
    (document.querySelector('[role="dialog"] form') as HTMLFormElement).requestSubmit();
  });

  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).toContain("Recommendation saved");
  expect(window.location.href).toBe(locationBefore);
});
```

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```bash
npm test -- tests/unit/inspectionRecommendationModal.test.tsx
```

Expected: FAIL because the checklist still assigns `window.location.href`.

- [ ] **Step 3: Pass current row values and show saved state**

In `InspectionItemRow.tsx`:

```tsx
// Add prop:
recommendationSaved?: boolean;

// Disable opening until the automatic status save and recommendation sync finish:
<button
  type="button"
  disabled={saveState === "saving"}
  onClick={() =>
    onRecommend?.({
      ...result,
      status,
      notes: notes.trim() || null,
    })
  }
  className="btn btn-secondary min-h-12"
>
  {recommendationSaved ? "Edit recommendation" : "Create recommendation"}
</button>

{recommendationSaved ? (
  <span role="status" className="text-sm font-medium text-emerald-700">
    Recommendation saved
  </span>
) : null}
```

Keep the button limited to Future and Now rows through the existing
`needsAttention` condition.

- [ ] **Step 4: Replace navigation with modal state**

In `InspectionChecklist.tsx`, import the modal and server action:

```ts
import { InspectionRecommendationModal } from "@/components/inspections/InspectionRecommendationModal";
import { saveInspectionRecommendationAction } from "@/app/(app)/work_orders/recommendation-actions";
```

Add state:

```ts
const [recommendationResult, setRecommendationResult] =
  useState<InspectionResultRow | null>(null);
const [savedRecommendationIds, setSavedRecommendationIds] = useState<
  Record<string, boolean>
>({});
```

Replace the existing `window.location.href` callback:

```tsx
onRecommend={canRecommend ? setRecommendationResult : undefined}
recommendationSaved={
  savedRecommendationIds[result.inspection_result_id] === true
}
```

Render the modal beside the lightbox at the bottom of the checklist:

```tsx
{
  recommendationResult ? (
    <InspectionRecommendationModal
      key={recommendationResult.inspection_result_id}
      result={recommendationResult}
      action={saveInspectionRecommendationAction.bind(
        null,
        inspection.work_order_id,
        recommendationResult.inspection_result_id
      )}
      onClose={() => setRecommendationResult(null)}
      onSaved={() => {
        setSavedRecommendationIds((current) => ({
          ...current,
          [recommendationResult.inspection_result_id]: true,
        }));
      }}
    />
  ) : null;
}
```

- [ ] **Step 5: Run the UI tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/inspectionRecommendationModal.test.tsx
```

Expected: PASS, including the no-navigation and saved-confirmation assertions.

---

### Task 4: Final verification

**Files:**

- Verify only; make no unrelated changes.

**Interfaces:**

- Verifies all interfaces produced by Tasks 1–3.

- [ ] **Step 1: Run focused tests**

```bash
npm test -- \
  tests/unit/inspectionRecommendations.test.ts \
  tests/unit/recommendationActions.test.ts \
  tests/unit/inspectionRecommendationModal.test.tsx \
  tests/unit/errors.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run static checks**

```bash
npm run typecheck
npx eslint \
  "lib/services/recommendations.ts" \
  "lib/services/errors.ts" \
  "app/(app)/work_orders/recommendation-actions.ts" \
  "components/inspections/InspectionRecommendationModal.tsx" \
  "components/inspections/InspectionChecklist.tsx" \
  "components/inspections/InspectionItemRow.tsx" \
  "tests/unit/inspectionRecommendations.test.ts" \
  "tests/unit/recommendationActions.test.ts" \
  "tests/unit/inspectionRecommendationModal.test.tsx"
```

Expected: both commands exit 0 with no diagnostics.

- [ ] **Step 3: Run the full unit suite**

```bash
npm test
```

Expected: all test files pass with zero failed tests.

- [ ] **Step 4: Run the production build**

```bash
npm run build
```

Expected: the Next.js production build exits 0.

- [ ] **Step 5: Review the final scoped diff**

```bash
git diff -- \
  "lib/services/recommendations.ts" \
  "lib/services/errors.ts" \
  "app/(app)/work_orders/recommendation-actions.ts" \
  "components/inspections/InspectionRecommendationModal.tsx" \
  "components/inspections/InspectionChecklist.tsx" \
  "components/inspections/InspectionItemRow.tsx" \
  "tests/unit/inspectionRecommendations.test.ts" \
  "tests/unit/recommendationActions.test.ts" \
  "tests/unit/inspectionRecommendationModal.test.tsx"
```

Expected: only the approved inline-recommendation behavior is present.
