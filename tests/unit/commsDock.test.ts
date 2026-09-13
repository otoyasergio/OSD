/** @vitest-environment jsdom */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommsDock } from "@/components/comms/CommsDock";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

function stubMatchMedia(mobileMatches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobileMatches,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("CommsDock header control", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  function mount(element: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(element);
    });
  }

  it("renders a Messages chip in the desktop header slot", () => {
    stubMatchMedia(false);
    mount(createElement(CommsDock, { slot: "desktop" }));

    const button = document.querySelector("button.comms-dock-chip");
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Messages");
    expect(document.querySelector(".comms-dock")?.className).not.toContain("fixed");
  });

  it("opens the recents panel from the header instead of a corner overlay", () => {
    stubMatchMedia(false);
    mount(createElement(CommsDock, { slot: "desktop" }));

    act(() => {
      document
        .querySelector("button.comms-dock-chip")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const panel = document.querySelector('[role="dialog"][aria-label="Messages"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Open hub");
    expect(panel?.textContent).toContain("No recent chats.");
  });

  it("renders exactly one panel when both responsive slots share one page", () => {
    stubMatchMedia(true);
    mount(
      createElement(
        "div",
        null,
        createElement(CommsDock, { slot: "mobile" }),
        createElement(CommsDock, { slot: "desktop" })
      )
    );

    const buttons = document.querySelectorAll("button[aria-haspopup='dialog']");
    expect(buttons.length).toBe(2);

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
  });
});
