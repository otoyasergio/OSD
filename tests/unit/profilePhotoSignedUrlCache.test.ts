import { describe, expect, it, vi } from "vitest";
import { createProfilePhotoSignedUrl } from "@/lib/profilePhotos/storage";

describe("createProfilePhotoSignedUrl", () => {
  it("reuses a signed URL so the next layout render does not resign", async () => {
    const path = `staff/${crypto.randomUUID()}.jpg`;
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

    const first = await createProfilePhotoSignedUrl(supabase as never, path);
    const second = await createProfilePhotoSignedUrl(supabase as never, path);

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(first).toBe(signedUrl);
    expect(second).toBe(signedUrl);
  });
});
