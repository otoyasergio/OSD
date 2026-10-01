import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addAuditLog,
  addTimelineEvent,
  createClient,
  requireUser,
  storageRemove,
  intakePhotoSelect,
  intakePhotoDelete,
  workOrderSelect,
} = vi.hoisted(() => ({
  addAuditLog: vi.fn(),
  addTimelineEvent: vi.fn(),
  createClient: vi.fn(),
  requireUser: vi.fn(),
  storageRemove: vi.fn(),
  intakePhotoSelect: vi.fn(),
  intakePhotoDelete: vi.fn(),
  workOrderSelect: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent }));

import { deleteIntakePhoto } from "@/lib/services/photos";
import { TimelineEventType } from "@/lib/timeline/events";

const WORK_ORDER_ID = "41111111-1111-4111-8111-111111111111";
const LOCATION_ID = "31111111-1111-4111-8111-111111111111";
const OTHER_LOCATION_ID = "32111111-1111-4111-8111-111111111111";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "71111111-1111-4111-8111-111111111111";
const UPLOADER_ID = "21111111-1111-4111-8111-111111111111";
const CREATED_AT = "2026-09-01T14:22:00.000Z";
const STORAGE_PATH = `${WORK_ORDER_ID}/front/${PHOTO_ID}.jpg`;
const THUMB_PATH = `${WORK_ORDER_ID}/front/${PHOTO_ID}.thumb.jpg`;

function user(role: string, locationId = LOCATION_ID) {
  return {
    user_id: USER_ID,
    role,
    status: "active",
    active_location_id: locationId,
    location_ids: [locationId],
  };
}

function photoRow() {
  return {
    photo_id: PHOTO_ID,
    work_order_id: WORK_ORDER_ID,
    uploaded_by_user_id: UPLOADER_ID,
    storage_path: STORAGE_PATH,
    thumb_storage_path: THUMB_PATH,
    photo_url: null,
    category: "front",
    notes: null,
    inspection_result_id: null,
    job_id: null,
    client_upload_id: null,
    content_type: "image/jpeg",
    byte_size: 12,
    pixel_width: 4,
    pixel_height: 4,
    created_at: CREATED_AT,
  };
}

function client() {
  const from = vi.fn((table: string) => {
    if (table === "work_order") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: workOrderSelect,
          }),
        }),
      };
    }
    if (table === "intake_photo") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: intakePhotoSelect,
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: intakePhotoDelete,
          }),
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    from,
    storage: {
      from: () => ({
        remove: storageRemove,
      }),
    },
  };
}

describe("deleteIntakePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workOrderSelect.mockResolvedValue({
      data: {
        work_order_id: WORK_ORDER_ID,
        location_id: LOCATION_ID,
        work_order_number: "WO-100",
        status: "open",
      },
      error: null,
    });
    intakePhotoSelect.mockResolvedValue({ data: photoRow(), error: null });
    intakePhotoDelete.mockResolvedValue({ error: null });
    storageRemove.mockResolvedValue({ error: null });
    addAuditLog.mockResolvedValue(undefined);
    addTimelineEvent.mockResolvedValue(undefined);
    createClient.mockResolvedValue(client());
    requireUser.mockResolvedValue(user("owner"));
  });

  it("rejects technicians and service advisors before any delete", async () => {
    requireUser.mockResolvedValue(user("technician"));
    await expect(
      deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "wrong angle")
    ).rejects.toThrow("FORBIDDEN");

    requireUser.mockResolvedValue(user("service_advisor"));
    await expect(
      deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "wrong angle")
    ).rejects.toThrow("FORBIDDEN");

    expect(intakePhotoDelete).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("rejects blank and oversized reasons before any delete", async () => {
    await expect(deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "   ")).rejects.toThrow(
      "PHOTO_CORRECTION_REASON_REQUIRED"
    );
    await expect(
      deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "z".repeat(501))
    ).rejects.toThrow("PHOTO_CORRECTION_REASON_TOO_LONG");
    expect(intakePhotoDelete).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("rejects a cross-location owner before deleting", async () => {
    requireUser.mockResolvedValue(user("owner", OTHER_LOCATION_ID));
    await expect(
      deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "wrong bike")
    ).rejects.toThrow("FOREIGN_LOCATION");
    expect(intakePhotoDelete).not.toHaveBeenCalled();
  });

  it("writes timeline and audit with reason and full evidence metadata", async () => {
    await deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "  cropped VIN  ");

    expect(addTimelineEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        work_order_id: WORK_ORDER_ID,
        user_id: USER_ID,
        event_type: TimelineEventType.INTAKE_PHOTO_DELETED,
        entity_type: "intake_photo",
        entity_id: PHOTO_ID,
        description: expect.stringMatching(/cropped VIN/),
        old_value: expect.objectContaining({
          reason: "cropped VIN",
          category: "front",
          storage_path: STORAGE_PATH,
          thumb_storage_path: THUMB_PATH,
          uploaded_by_user_id: UPLOADER_ID,
          created_at: CREATED_AT,
        }),
      })
    );
    expect(String(addTimelineEvent.mock.calls[0][1].description)).toMatch(/front/i);
    expect(addAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor_user_id: USER_ID,
        location_id: LOCATION_ID,
        action: "intake_photo_deleted",
        entity_type: "intake_photo",
        entity_id: PHOTO_ID,
        description: expect.stringMatching(/cropped VIN/),
        old_value: expect.objectContaining({
          reason: "cropped VIN",
          category: "front",
          storage_path: STORAGE_PATH,
          thumb_storage_path: THUMB_PATH,
          uploaded_by_user_id: UPLOADER_ID,
          created_at: CREATED_AT,
        }),
      })
    );
  });

  it("allows owner/manager corrective delete on a completed work order", async () => {
    workOrderSelect.mockResolvedValue({
      data: {
        work_order_id: WORK_ORDER_ID,
        location_id: LOCATION_ID,
        work_order_number: "WO-100",
        status: "completed",
      },
      error: null,
    });
    requireUser.mockResolvedValue(user("manager"));

    await deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "customer asked to remove");
    expect(intakePhotoDelete).toHaveBeenCalled();
    expect(storageRemove).toHaveBeenCalledWith([STORAGE_PATH, THUMB_PATH]);
  });

  it("deletes the row first and privacy-safely logs a storage orphan", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    storageRemove.mockResolvedValue({
      error: {
        message: "https://signed.example/secret.jpg token=abc",
        statusCode: 403,
      },
    });

    const order: string[] = [];
    intakePhotoDelete.mockImplementation(async () => {
      order.push("row");
      return { error: null };
    });
    storageRemove.mockImplementation(async () => {
      order.push("storage");
      return {
        error: {
          message: "https://signed.example/secret.jpg token=abc",
          statusCode: 403,
        },
      };
    });

    await deleteIntakePhoto(WORK_ORDER_ID, PHOTO_ID, "wrong motorcycle");

    expect(order).toEqual(["row", "storage"]);
    expect(addAuditLog).toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toMatch(/intake photo storage remove failed/i);
    expect(logged).not.toContain("signed.example");
    expect(logged).not.toContain("token=abc");
    expect(logged).toContain(PHOTO_ID);
    errorSpy.mockRestore();
  });
});
