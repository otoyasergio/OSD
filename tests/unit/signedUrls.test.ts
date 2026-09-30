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
});
