import type { DiagnosticsThreadWorkspace } from "@/lib/services/diagnosticsAssistant";

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
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{2,60}$/.test(error.message)
        ? error.message
        : "UNKNOWN";
    console.warn("ask otomoto thread unavailable", code);
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
