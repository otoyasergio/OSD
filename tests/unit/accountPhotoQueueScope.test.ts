/** @vitest-environment jsdom */
import { createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AccountPhotoQueueScope } from "@/components/account/AccountPhotoQueueScope";
import { SignOutButton } from "@/components/layout/SignOutButton";
import {
  usePhotoUploadQueue,
  type PhotoUploadQueueApi,
} from "@/components/photos/PhotoUploadQueueProvider";
import {
  createMemoryPhotoUploadQueueDatabase,
  MemoryPhotoUploadQueueStore,
} from "@/tests/helpers/memoryPhotoUploadQueueStore";

const { signOutAction } = vi.hoisted(() => ({
  signOutAction: vi.fn(),
}));

vi.mock("@/app/(app)/actions/sign-out", () => ({ signOutAction }));

describe("account photo queue scope", () => {
  it("wraps authenticated account content when the user has an active location", () => {
    const source = readFileSync(join(process.cwd(), "app/account/page.tsx"), "utf8");
    expect(source).toMatch(/AccountPhotoQueueScope/);
    expect(source).toMatch(/user\.active_location_id/);
    expect(source).toMatch(/SignOutButton/);
  });

  it("keys the queue provider by user and location", () => {
    const account = readFileSync(
      join(process.cwd(), "components/account/AccountPhotoQueueScope.tsx"),
      "utf8"
    );
    const appShell = readFileSync(
      join(process.cwd(), "components/layout/AppShell.tsx"),
      "utf8"
    );
    expect(account).toMatch(/photoUploadQueueProviderKey\(/);
    expect(account).toMatch(/durableQueueEnabled/);
    expect(appShell).toMatch(/photoUploadQueueProviderKey\(/);
    expect(appShell).toMatch(/durableQueueEnabled=/);
  });
});

describe("AccountPhotoQueueScope", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:account") as never;
    URL.revokeObjectURL = vi.fn() as never;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("leaves users without a location unscoped", async () => {
    let threw: unknown = null;
    function Probe() {
      try {
        usePhotoUploadQueue();
      } catch (error) {
        threw = error;
      }
      return createElement("span", null, "unscoped");
    }
    await act(async () => {
      root.render(
        createElement(
          AccountPhotoQueueScope,
          { userId: "user-a", locationId: null },
          createElement(Probe),
          createElement(SignOutButton)
        )
      );
    });
    expect(container.textContent).toMatch(/unscoped/);
    expect(String(threw)).toMatch(/must be used within PhotoUploadQueueProvider/);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const signOut = Array.from(container.querySelectorAll("button")).find((button) =>
      /sign out/i.test(button.textContent ?? "")
    )!;
    await act(async () => {
      signOut.click();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(signOutAction).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("warns on sign-out when the scoped account queue still has pending items", async () => {
    const store = new MemoryPhotoUploadQueueStore(createMemoryPhotoUploadQueueDatabase());
    let api: PhotoUploadQueueApi | null = null;
    function Probe() {
      const queue = usePhotoUploadQueue();
      useEffect(() => {
        api = queue;
      }, [queue]);
      return null;
    }
    await act(async () => {
      root.render(
        createElement(
          AccountPhotoQueueScope,
          {
            userId: "user-a",
            locationId: "location-a",
            store,
            isOnline: () => false,
          },
          createElement(Probe),
          createElement(SignOutButton)
        )
      );
    });
    await act(async () => {
      await api!.enqueue({
        file: new File(["bytes"], "front.jpg", { type: "image/jpeg" }),
        category: "front",
        workOrderId: "wo-1",
      });
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const signOut = Array.from(container.querySelectorAll("button")).find((button) =>
      /sign out/i.test(button.textContent ?? "")
    )!;
    await act(async () => {
      signOut.click();
    });
    expect(confirm).toHaveBeenCalled();
    expect(String(confirm.mock.calls[0]?.[0])).toMatch(
      /resume only when the same user signs in on this device/i
    );
    expect(signOutAction).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
