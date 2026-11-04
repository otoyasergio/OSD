import { describe, expect, it, vi } from "vitest";
import { signStoragePaths } from "@/lib/photos/signedUrls";

describe("signStoragePaths", () => {
  it("reuses a signed URL so the next render does not download the photo again", async () => {
    const path = `wo/inspection_tires/${crypto.randomUUID()}.jpg`;
    const signedUrl = `https://cdn.example/${path}?token=1`;
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ path, signedUrl }],
      error: null,
    });
    const supabase = {
      storage: {
        from: () => ({ createSignedUrls }),
      },
    };

    const first = await signStoragePaths(supabase as never, [path]);
    const second = await signStoragePaths(supabase as never, [path]);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(second.get(path)).toBe(signedUrl);
    expect(first.get(path)).toBe(signedUrl);
  });

  it("keeps an omitted path in the map so callers can tell it was not signed", async () => {
    const present = `wo/present/${crypto.randomUUID()}.jpg`;
    const omitted = `wo/omitted/${crypto.randomUUID()}.jpg`;
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ path: present, signedUrl: "https://cdn.example/present" }],
      error: null,
    });
    const supabase = {
      storage: {
        from: () => ({ createSignedUrls }),
      },
    };

    const signed = await signStoragePaths(supabase as never, [present, omitted]);

    expect(signed.get(present)).toBe("https://cdn.example/present");
    expect(signed.has(omitted)).toBe(true);
    expect(signed.get(omitted)).toBeNull();
  });

  it("does not cache a signing failure, so the next render can recover", async () => {
    const path = `wo/failed/${crypto.randomUUID()}.jpg`;
    const createSignedUrls = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "down" } })
      .mockResolvedValueOnce({
        data: [{ path, signedUrl: "https://cdn.example/recovered" }],
        error: null,
      });
    const supabase = {
      storage: { from: () => ({ createSignedUrls }) },
    };

    const failed = await signStoragePaths(supabase as never, [path]);
    const recovered = await signStoragePaths(supabase as never, [path]);

    expect(failed.get(path)).toBeNull();
    expect(recovered.get(path)).toBe("https://cdn.example/recovered");
    expect(createSignedUrls).toHaveBeenCalledTimes(2);
  });

  it("signs a short-lived link again instead of reusing the staff cache", async () => {
    const path = `wo/portal/${crypto.randomUUID()}.jpg`;
    const createSignedUrls = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ path, signedUrl: "https://cdn.example/a" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ path, signedUrl: "https://cdn.example/b" }],
        error: null,
      });
    const supabase = {
      storage: { from: () => ({ createSignedUrls }) },
    };

    await signStoragePaths(supabase as never, [path], 60);
    const second = await signStoragePaths(supabase as never, [path], 60);

    expect(createSignedUrls).toHaveBeenCalledTimes(2);
    expect(second.get(path)).toBe("https://cdn.example/b");
  });
});
