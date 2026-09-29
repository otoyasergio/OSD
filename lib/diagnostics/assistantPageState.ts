import type { ReadView } from "@/lib/auth/role-preview-shared";
import type { UserRole } from "@/lib/database/types";
import {
  canCompleteJob,
  canCreateWorkOrder,
  canEditWorkOrder,
  canViewClients,
  canViewPricing,
  isFloorTech,
} from "@/lib/permissions";
import {
  toAskOtomotoThreadListItems,
  toAskOtomotoWorkspaceView,
  type AskOtomotoCapabilities,
  type AskOtomotoLockReason,
  type AskOtomotoSurface,
  type AskOtomotoThreadListItem,
  type AskOtomotoWorkspaceView,
} from "@/lib/diagnostics/askOtomotoView";
import type {
  DiagnosticsThreadSummary,
  DiagnosticsThreadWorkspace,
} from "@/lib/services/diagnosticsAssistant";

function safeLogCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message)
    ? error.message
    : "UNKNOWN";
}

/**
 * Page loaders must not crash the work-order screen when the `?thread=` id is
 * stale, foreign, or no longer readable; the UI shows "unavailable" instead.
 * Only the error class is logged — messages can embed customer data.
 */
export async function loadAssistantWorkspaceOrNull(
  load: () => Promise<DiagnosticsThreadWorkspace>
): Promise<DiagnosticsThreadWorkspace | null> {
  try {
    return await load();
  } catch (error) {
    console.warn("ask otomoto thread unavailable", safeLogCode(error));
    return null;
  }
}

export type AssistantComposerFlags = {
  canMutate: boolean;
  preview: boolean;
  readOnly: boolean;
};

export function assistantComposerFlags(input: {
  isForeignLocation: boolean;
  isPreviewing: boolean;
  workOrderStatus: string;
  hasWriteRole: boolean;
}): AssistantComposerFlags {
  const readOnly =
    input.isForeignLocation ||
    input.workOrderStatus === "completed" ||
    input.workOrderStatus === "cancelled";
  return {
    canMutate: input.hasWriteRole && !input.isPreviewing && !readOnly,
    preview: input.isPreviewing,
    readOnly,
  };
}

/**
 * UI capability flags derived from the presentation role. The backend
 * re-authorizes every action; these only decide what is offered.
 */
export function askOtomotoCapabilities(input: {
  surface: AskOtomotoSurface;
  viewRole: UserRole;
  isForeignLocation: boolean;
  isPreviewing: boolean;
  workOrderStatus: string;
}): AskOtomotoCapabilities {
  const role = input.viewRole;
  const hasWriteRole =
    isFloorTech(role) || canEditWorkOrder(role) || canCreateWorkOrder(role);
  const flags = assistantComposerFlags({
    isForeignLocation: input.isForeignLocation,
    isPreviewing: input.isPreviewing,
    workOrderStatus: input.workOrderStatus,
    hasWriteRole,
  });
  const lockReason: AskOtomotoLockReason | null = input.isPreviewing
    ? "preview"
    : input.isForeignLocation
      ? "foreign"
      : flags.readOnly
        ? "locked"
        : !hasWriteRole
          ? "role"
          : null;
  const canAddNotes =
    canCompleteJob(role) || canEditWorkOrder(role) || canCreateWorkOrder(role);
  return {
    ...flags,
    lockReason,
    canUseFrontOfficeModes:
      input.surface === "office" &&
      !isFloorTech(role) &&
      canViewClients(role) &&
      canViewPricing(role),
    canPromoteNotes: flags.canMutate && canAddNotes,
  };
}

type AskOtomotoReadService = {
  listThreads(
    workOrderId: string,
    readView?: ReadView
  ): Promise<DiagnosticsThreadSummary[]>;
  loadThread(
    workOrderId: string,
    threadId: string,
    readView?: ReadView
  ): Promise<DiagnosticsThreadWorkspace>;
};

export type AskOtomotoLoadedData = {
  threads: AskOtomotoThreadListItem[];
  workspace: AskOtomotoWorkspaceView | null;
  historyUnavailable: boolean;
};

/**
 * Loads the visible thread list and (optionally) the selected workspace in
 * parallel. The backend filters by role/assignment; the floor additionally
 * never shows front-office threads.
 */
export async function loadAskOtomotoPanelData(input: {
  service: AskOtomotoReadService;
  surface: AskOtomotoSurface;
  workOrderId: string;
  threadId: string | null;
  readView?: ReadView;
  jobLabels: Readonly<Record<string, string>>;
}): Promise<AskOtomotoLoadedData> {
  const [threadsResult, workspace] = await Promise.all([
    input.service
      .listThreads(input.workOrderId, input.readView)
      .then((threads) => ({ ok: true as const, threads }))
      .catch((error: unknown) => {
        console.warn("ask otomoto history unavailable", safeLogCode(error));
        return { ok: false as const, threads: [] as DiagnosticsThreadSummary[] };
      }),
    input.threadId
      ? loadAssistantWorkspaceOrNull(() =>
          input.service.loadThread(input.workOrderId, input.threadId!, input.readView)
        )
      : Promise.resolve(null),
  ]);
  const visibleWorkspace =
    workspace && (input.surface === "office" || workspace.thread.audience === "technical")
      ? toAskOtomotoWorkspaceView(workspace)
      : null;
  return {
    threads: toAskOtomotoThreadListItems(threadsResult.threads, {
      surface: input.surface,
      jobLabels: input.jobLabels,
    }),
    workspace: visibleWorkspace,
    historyUnavailable: !threadsResult.ok,
  };
}
