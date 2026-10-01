import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addAuditLog,
  createClient,
  getCurrentAppUser,
  requireUser,
  storageUpload,
  storageRemove,
  createAdminClient,
} = vi.hoisted(() => ({
  addAuditLog: vi.fn(),
  createClient: vi.fn(),
  getCurrentAppUser: vi.fn(),
  requireUser: vi.fn(),
  storageUpload: vi.fn(),
  storageRemove: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser, requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/audit/addAuditLog", () => ({ addAuditLog }));
vi.mock("@/lib/timeline/addTimelineEvent", () => ({ addTimelineEvent: vi.fn() }));

import { uploadOwnProfilePhoto } from "@/lib/services/profilePhotos";
import { uploadCustomerDocument } from "@/lib/services/customerDocuments";
import { uploadStaffDocument } from "@/lib/services/staffProfiles";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "31111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "51111111-1111-4111-8111-111111111111";
const HEIC = readFileSync(join(process.cwd(), "tests/fixtures/photos/sample.heic"));
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const actor = {
  user_id: USER_ID,
  role: "owner",
  status: "active",
  active_location_id: LOCATION_ID,
  location_ids: [LOCATION_ID],
  first_name: "Ada",
  last_name: "Owner",
  profile_photo_path: null,
};

function storageClient(tables: Record<string, unknown> = {}) {
  const storage = {
    upload: storageUpload,
    remove: storageRemove,
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://signed.example/${path}` },
      error: null,
    })),
  };
  const from = vi.fn((table: string) => {
    if (tables[table]) return tables[table];
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    from,
    storage: { from: () => storage },
  };
}

describe("profile/customer/staff uploads canonicalize HEIC and keep PDFs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentAppUser.mockResolvedValue(actor);
    requireUser.mockResolvedValue(actor);
    storageUpload.mockResolvedValue({ error: null });
    storageRemove.mockResolvedValue({ error: null });
    addAuditLog.mockResolvedValue(undefined);
  });

  it("stores a profile HEIC fallback as JPEG and cleans up the previous photo", async () => {
    const previousPath = `${USER_ID}/old.png`;
    getCurrentAppUser.mockResolvedValue({
      ...actor,
      profile_photo_path: previousPath,
    });
    const appUserUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    createAdminClient.mockReturnValue({
      from: () => ({ update: appUserUpdate }),
    });
    createClient.mockResolvedValue(storageClient());

    await uploadOwnProfilePhoto(new File([HEIC], "IMG_1234.HEIC", { type: "" }));

    expect(storageUpload).toHaveBeenCalledTimes(1);
    const [path, bytes, options] = storageUpload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${USER_ID}/[0-9a-f-]+\\.jpg$`));
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(storageRemove).toHaveBeenCalledWith([previousPath]);
  });

  it("rejects a technician uploading a customer document", async () => {
    requireUser.mockResolvedValue({ ...actor, role: "technician" });
    await expect(
      uploadCustomerDocument(CUSTOMER_ID, {
        title: "Insurance",
        file: new File([PDF], "card.pdf", { type: "application/pdf" }),
      })
    ).rejects.toThrow("FORBIDDEN");
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("stores a customer HEIC as JPEG and a PDF unchanged, with audit", async () => {
    const customerLookup = {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { customer_id: CUSTOMER_ID },
            error: null,
          }),
        }),
      }),
    };
    const inserted = {
      document_id: "doc-1",
      customer_id: CUSTOMER_ID,
      title: "Insurance",
      source: "upload",
      work_order_id: null,
      agreement_id: null,
      storage_bucket: "customer-documents",
      storage_path: `${CUSTOMER_ID}/doc-1.jpg`,
      mime_type: "image/jpeg",
      file_size: 12,
      uploaded_by_user_id: USER_ID,
      created_at: "2026-10-01T00:00:00.000Z",
    };
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: inserted, error: null }),
      }),
    });
    createClient.mockResolvedValue(
      storageClient({
        customer: customerLookup,
        customer_document: { insert },
      })
    );

    const heicResult = await uploadCustomerDocument(CUSTOMER_ID, {
      title: "Insurance card",
      file: new File([HEIC], "card.HEIC", { type: "image/heic" }),
    });

    expect(storageUpload.mock.calls[0][0]).toMatch(/\.jpg$/);
    expect(storageUpload.mock.calls[0][2]).toMatchObject({ contentType: "image/jpeg" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        mime_type: "image/jpeg",
        storage_path: expect.stringMatching(/\.jpg$/),
      })
    );
    expect(addAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "customer_document_uploaded",
        entity_type: "customer_document",
      })
    );
    expect(heicResult.mime_type).toBe("image/jpeg");

    storageUpload.mockClear();
    insert.mockClear();
    const pdfInserted = {
      ...inserted,
      document_id: "doc-2",
      storage_path: `${CUSTOMER_ID}/doc-2.pdf`,
      mime_type: "application/pdf",
    };
    insert.mockReturnValue({
      select: () => ({
        single: async () => ({ data: pdfInserted, error: null }),
      }),
    });

    const pdfResult = await uploadCustomerDocument(CUSTOMER_ID, {
      title: "Insurance pdf",
      file: new File([PDF], "card.pdf", { type: "application/pdf" }),
    });

    expect(storageUpload.mock.calls[0][0]).toMatch(/\.pdf$/);
    expect(storageUpload.mock.calls[0][2]).toMatchObject({
      contentType: "application/pdf",
    });
    expect(Buffer.from(storageUpload.mock.calls[0][1]).equals(PDF)).toBe(true);
    expect(pdfResult.mime_type).toBe("application/pdf");
  });

  it("removes the customer object after an insert failure", async () => {
    createClient.mockResolvedValue(
      storageClient({
        customer: {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { customer_id: CUSTOMER_ID },
                error: null,
              }),
            }),
          }),
        },
        customer_document: {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: "insert failed" } }),
            }),
          }),
        },
      })
    );

    await expect(
      uploadCustomerDocument(CUSTOMER_ID, {
        title: "Insurance",
        file: new File([PDF], "card.pdf", { type: "application/pdf" }),
      })
    ).rejects.toMatchObject({ message: "insert failed" });
    expect(storageRemove).toHaveBeenCalled();
  });

  it("stores a staff HEIC as JPEG and keeps retention plus audit", async () => {
    const employment = {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { employment_end_date: null },
            error: null,
          }),
        }),
      }),
    };
    const inserted = {
      document_id: "staff-doc-1",
      user_id: USER_ID,
      title: "Agreement",
      category: "employment_agreement",
      storage_bucket: "staff-documents",
      storage_path: `${USER_ID}/staff-doc-1.jpg`,
      mime_type: "image/jpeg",
      file_size: 12,
      uploaded_by_user_id: USER_ID,
      created_at: "2026-10-01T00:00:00.000Z",
      retention_until: "2029-10-01",
      voided_at: null,
    };
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: inserted, error: null }),
      }),
    });
    createClient
      .mockResolvedValueOnce(
        storageClient({
          staff_employment_record: employment,
        })
      )
      .mockResolvedValueOnce(
        storageClient({
          staff_employment_record: employment,
          staff_document: { insert },
        })
      );

    await uploadStaffDocument(USER_ID, {
      title: "Agreement scan",
      category: "employment_agreement",
      file: new File([HEIC], "scan.HEIC", { type: "" }),
    });

    expect(storageUpload.mock.calls[0][0]).toMatch(/\.jpg$/);
    expect(storageUpload.mock.calls[0][2]).toMatchObject({ contentType: "image/jpeg" });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        mime_type: "image/jpeg",
        retention_until: expect.any(String),
      })
    );
    expect(addAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "staff_document_upload",
        entity_type: "staff_document",
      })
    );
  });

  it("stores a staff PDF unchanged", async () => {
    const employment = {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    };
    const inserted = {
      document_id: "staff-doc-2",
      user_id: USER_ID,
      title: "Policy",
      category: "policy_ack",
      storage_bucket: "staff-documents",
      storage_path: `${USER_ID}/staff-doc-2.pdf`,
      mime_type: "application/pdf",
      file_size: PDF.byteLength,
      uploaded_by_user_id: USER_ID,
      created_at: "2026-10-01T00:00:00.000Z",
      retention_until: "2029-10-01",
      voided_at: null,
    };
    createClient
      .mockResolvedValueOnce(storageClient({ staff_employment_record: employment }))
      .mockResolvedValueOnce(
        storageClient({
          staff_employment_record: employment,
          staff_document: {
            insert: () => ({
              select: () => ({
                single: async () => ({ data: inserted, error: null }),
              }),
            }),
          },
        })
      );

    await uploadStaffDocument(USER_ID, {
      title: "Policy",
      category: "policy_ack",
      file: new File([PDF], "policy.pdf", { type: "application/pdf" }),
    });

    expect(storageUpload.mock.calls[0][0]).toMatch(/\.pdf$/);
    expect(storageUpload.mock.calls[0][2]).toMatchObject({
      contentType: "application/pdf",
    });
    expect(Buffer.from(storageUpload.mock.calls[0][1]).equals(PDF)).toBe(true);
  });
});
