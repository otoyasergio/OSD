/** @vitest-environment jsdom */
import { createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoverableSignedImage } from "@/components/photos/RecoverableSignedImage";
import {
  isSupabaseSignedObjectUrl,
  resetSignedImageRecovery,
  useSignedImageRecovery,
} from "@/lib/photos/useSignedImageRecovery";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const SIGNED =
  "https://abc.supabase.co/storage/v1/object/sign/intake-photos/wo/front.jpg?token=abc.def";

function HookProbe({
  src,
  onError,
}: {
  src: string;
  onError?: (event: { type: string }) => void;
}) {
  const handleError = useSignedImageRecovery(src, onError);
  return createElement("img", {
    src,
    alt: "probe",
    onError: handleError,
  });
}

describe("isSupabaseSignedObjectUrl", () => {
  it("accepts only Supabase signed object URLs", () => {
    expect(isSupabaseSignedObjectUrl(SIGNED)).toBe(true);
    expect(
      isSupabaseSignedObjectUrl(
        "https://xyz.supabase.co/storage/v1/object/sign/profile-photos/u/1.jpg?token=tok"
      )
    ).toBe(true);
  });

  it("rejects blob, data, local queue, and plain URLs", () => {
    expect(isSupabaseSignedObjectUrl("blob:https://app.local/queue-1")).toBe(false);
    expect(isSupabaseSignedObjectUrl("data:image/jpeg;base64,abc")).toBe(false);
    expect(isSupabaseSignedObjectUrl("https://example.com/photo.jpg")).toBe(false);
    expect(
      isSupabaseSignedObjectUrl(
        "https://abc.supabase.co/storage/v1/object/public/intake-photos/wo/front.jpg"
      )
    ).toBe(false);
  });
});

describe("useSignedImageRecovery", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    refresh.mockClear();
    resetSignedImageRecovery();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("refreshes once per signed URL and preserves the caller onError", async () => {
    const onError = vi.fn();
    await act(async () => {
      root.render(createElement(HookProbe, { src: SIGNED, onError }));
    });
    const img = container.querySelector("img") as HTMLImageElement;

    await act(async () => {
      img.dispatchEvent(new Event("error"));
      img.dispatchEvent(new Event("error"));
    });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh local, data, or plain URLs", async () => {
    for (const src of [
      "blob:https://app.local/queue-1",
      "data:image/jpeg;base64,abc",
      "https://cdn.example/photo.jpg",
    ]) {
      await act(async () => {
        root.render(createElement(HookProbe, { src }));
      });
      const img = container.querySelector("img") as HTMLImageElement;
      await act(async () => {
        img.dispatchEvent(new Event("error"));
      });
    }
    expect(refresh).not.toHaveBeenCalled();
  });

  it("coalesces multiple unique signed failures into one refresh burst", async () => {
    const onError = vi.fn();
    const second =
      "https://abc.supabase.co/storage/v1/object/sign/intake-photos/wo/rear.jpg?token=rear";

    function DualProbe() {
      return createElement(
        "div",
        null,
        createElement(HookProbe, { src: SIGNED, onError }),
        createElement(HookProbe, { src: second, onError })
      );
    }

    await act(async () => {
      root.render(createElement(DualProbe));
    });
    const images = [...container.querySelectorAll("img")];
    await act(async () => {
      images[0]?.dispatchEvent(new Event("error"));
      images[1]?.dispatchEvent(new Event("error"));
    });

    expect(onError).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      images[0]?.dispatchEvent(new Event("error"));
      images[1]?.dispatchEvent(new Event("error"));
    });
    expect(onError).toHaveBeenCalledTimes(4);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not loop after a remount of the same failed signed URL", async () => {
    function Remountable() {
      const [tick, setTick] = useState(0);
      return createElement(
        "div",
        null,
        createElement(HookProbe, { src: SIGNED, key: String(tick) }),
        createElement(
          "button",
          { type: "button", onClick: () => setTick((value) => value + 1) },
          "remount"
        )
      );
    }

    await act(async () => {
      root.render(createElement(Remountable));
    });
    await act(async () => {
      container.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector("button")?.click();
    });
    await act(async () => {
      container.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("RecoverableSignedImage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    refresh.mockClear();
    resetSignedImageRecovery();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("forwards img props and recovers a signed URL once", async () => {
    const onError = vi.fn();
    await act(async () => {
      root.render(
        createElement(RecoverableSignedImage, {
          src: SIGNED,
          alt: "Front",
          className: "photo",
          onError,
        })
      );
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.alt).toBe("Front");
    expect(img.className).toBe("photo");
    await act(async () => {
      img.dispatchEvent(new Event("error"));
      img.dispatchEvent(new Event("error"));
    });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
