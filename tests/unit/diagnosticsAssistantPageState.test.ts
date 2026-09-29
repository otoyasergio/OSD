import { describe, expect, it, vi } from "vitest";
import {
  assistantComposerFlags,
  loadAssistantWorkspaceOrNull,
} from "@/lib/diagnostics/assistantPageState";

describe("loadAssistantWorkspaceOrNull", () => {
  const workspace = { thread: { threadId: "t" }, messages: [] };

  it("returns the workspace when the load succeeds", async () => {
    await expect(
      loadAssistantWorkspaceOrNull(async () => workspace as never)
    ).resolves.toBe(workspace);
  });

  it.each(["ASK_OTOMOTO_THREAD_NOT_FOUND", "FOREIGN_LOCATION", "FORBIDDEN", "PGRST116"])(
    "shows unavailable (null) instead of throwing for %s",
    async (code) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await expect(
        loadAssistantWorkspaceOrNull(async () => {
          throw new Error(code);
        })
      ).resolves.toBeNull();
      warn.mockRestore();
    }
  );

  it("does not log raw error messages that could carry customer data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadAssistantWorkspaceOrNull(async () => {
      throw new Error("row for Jane Doe 647-555-0100 failed");
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Jane|647/);
    warn.mockRestore();
  });
});

describe("assistantComposerFlags", () => {
  const base = {
    isForeignLocation: false,
    isPreviewing: false,
    workOrderStatus: "in_progress",
    hasWriteRole: true,
  };

  it("allows mutation for an active, non-preview, writable work order", () => {
    expect(assistantComposerFlags(base)).toEqual({
      canMutate: true,
      preview: false,
      readOnly: false,
    });
  });

  it("marks preview and foreign locations read-only and non-mutable", () => {
    expect(assistantComposerFlags({ ...base, isPreviewing: true })).toEqual({
      canMutate: false,
      preview: true,
      readOnly: false,
    });
    expect(assistantComposerFlags({ ...base, isForeignLocation: true })).toEqual({
      canMutate: false,
      preview: false,
      readOnly: true,
    });
  });

  it.each(["completed", "cancelled"])("treats a %s work order as read-only", (status) => {
    expect(assistantComposerFlags({ ...base, workOrderStatus: status })).toEqual({
      canMutate: false,
      preview: false,
      readOnly: true,
    });
  });

  it("denies mutation without a write role", () => {
    expect(assistantComposerFlags({ ...base, hasWriteRole: false }).canMutate).toBe(
      false
    );
  });
});
