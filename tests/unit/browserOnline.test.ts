import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBrowserOffline,
  isBrowserOnline,
  resetBrowserOnlineForTests,
} from "@/lib/forms/browserOnline";

describe("isBrowserOffline", () => {
  afterEach(() => {
    resetBrowserOnlineForTests();
    vi.unstubAllGlobals();
  });

  it("is true when navigator.onLine is false", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isBrowserOffline()).toBe(true);
    expect(isBrowserOnline()).toBe(false);
  });

  it("treats a window offline event as offline even when navigator.onLine stays true", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    vi.stubGlobal("navigator", { onLine: true });

    expect(isBrowserOffline()).toBe(false);
    target.dispatchEvent(new Event("offline"));
    expect(isBrowserOffline()).toBe(true);
    expect(isBrowserOnline()).toBe(false);

    target.dispatchEvent(new Event("online"));
    expect(isBrowserOffline()).toBe(false);
  });
});
