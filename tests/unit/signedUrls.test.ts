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
});
