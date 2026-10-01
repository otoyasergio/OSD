import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addAuditLog, addTimelineEvent, createClient, requireUser, storageUpload } =
  vi.hoisted(() => ({
    addAuditLog: vi.fn(),
    addTimelineEvent: vi.fn(),
    createClient: vi.fn(),
    requireUser: vi.fn(),
    storageUpload: vi.fn(),
  }));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));

import { uploadIntakePhoto } from "@/lib/services/photos";

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const LOCATION_ID = "31111111-1111-4111-8111-111111111111";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function client() {
  const storage = {
    upload: storageUpload,
    remove: vi.fn(async () => ({ error: null })),
    createSignedUrls: vi.fn(async (paths: string[]) => ({
      data: paths.map((path) => ({
        path,
        signedUrl: `https://signed.example/${path}`,
      })),
      error: null,
    })),
  };
  const from = vi.fn((table: string) => {
    if (table === "work_order") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                work_order_id: WORK_ORDER_ID,
                location_id: LOCATION_ID,
                work_order_number: "WO-100",
                status: "open",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "intake_photo") {
      return {
        insert: (insert: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({
              data: {
                ...insert,
                photo_url: null,
                created_at: "2026-10-01T00:00:00.000Z",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    from,
    storage: {
      from: () => storage,
    },
  };
}

describe("uploadIntakePhoto canonical validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user_id: USER_ID,
      role: "owner",
      status: "active",
      active_location_id: LOCATION_ID,
      location_ids: [LOCATION_ID],
    });
    storageUpload.mockResolvedValue({ error: null });
    createClient.mockResolvedValue(client());
  });

  it("fails invalid image bytes before any storage write", async () => {
    const file = new File([Buffer.from("not an image")], "fake.jpg", {
      type: "image/jpeg",
    });

    await expect(
      uploadIntakePhoto(WORK_ORDER_ID, {
        category: "front",
        file,
      })
    ).rejects.toThrow("PHOTO_TYPE_INVALID");
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects a malformed client upload ID before any storage write", async () => {
    const jpeg = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#000000",
      },
    })
      .jpeg()
      .toBuffer();
    const input = {
      category: "front" as const,
      client_upload_id: "not-a-uuid",
      file: new File([jpeg], "valid.jpg", { type: "image/jpeg" }),
    };

    await expect(uploadIntakePhoto(WORK_ORDER_ID, input)).rejects.toThrow();
    expect(storageUpload).not.toHaveBeenCalled();
  });
});
