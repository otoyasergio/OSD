import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import {
  canDeleteCustomerDocuments,
  canUploadCustomerDocuments,
  canViewCustomerDocuments,
} from "@/lib/permissions";

export type CustomerDocumentSource = "upload" | "drop_off_agreement";

export type CustomerDocument = {
  document_id: string;
  customer_id: string;
  title: string;
  source: CustomerDocumentSource;
  work_order_id: string | null;
  agreement_id: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size: number | null;
  uploaded_by_user_id: string | null;
  created_at: string;
  signed_url: string | null;
  work_order_number: string | null;
};

const UPLOAD_BUCKET = "customer-documents";
const CONTRACT_BUCKET = "contract-signatures";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const COLUMNS =
  "document_id, customer_id, title, source, work_order_id, agreement_id, storage_bucket, storage_path, mime_type, file_size, uploaded_by_user_id, created_at";

function extensionForType(type: string): string {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic" || type === "image/heif") return "heic";
  return "jpg";
}

function dropOffTitle(workOrderNumber: string, signedAt: string | Date): string {
  const date =
    typeof signedAt === "string"
      ? signedAt.slice(0, 10)
      : signedAt.toISOString().slice(0, 10);
  return `Drop-off agreement — ${workOrderNumber} (${date})`;
}

function mimeFromSignaturePath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

/** Insert profile document for a newly signed drop-off agreement (idempotent). */
export async function fileDropOffAgreementDocument(
  supabase: DbClient,
  input: {
    customer_id: string;
    work_order_id: string;
    work_order_number: string;
    agreement_id: string;
    signature_storage_path: string;
    signed_at?: string | null;
    uploaded_by_user_id?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("customer_document").insert({
    customer_id: input.customer_id,
    title: dropOffTitle(
      input.work_order_number,
      input.signed_at ?? new Date().toISOString()
    ),
    source: "drop_off_agreement",
    work_order_id: input.work_order_id,
    agreement_id: input.agreement_id,
    storage_bucket: CONTRACT_BUCKET,
    storage_path: input.signature_storage_path,
    mime_type: mimeFromSignaturePath(input.signature_storage_path),
    file_size: null,
    uploaded_by_user_id: input.uploaded_by_user_id ?? null,
  });

  // Unique on agreement_id — ignore races / double calls.
  if (error && error.code !== "23505") throw error;
}

export async function listCustomerDocuments(
  customerId: string
): Promise<CustomerDocument[]> {
  const user = await requireUser();
  if (!canViewCustomerDocuments(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_document")
    .select(
      `
      ${COLUMNS},
      work_order:work_order_id ( work_order_number )
    `
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  const withUrls: CustomerDocument[] = [];

  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const bucket = record.storage_bucket as string;
    const path = record.storage_path as string;
    const { data: signed } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);

    const wo = record.work_order as { work_order_number: string } | null;

    withUrls.push({
      document_id: record.document_id as string,
      customer_id: record.customer_id as string,
      title: record.title as string,
      source: record.source as CustomerDocumentSource,
      work_order_id: (record.work_order_id as string | null) ?? null,
      agreement_id: (record.agreement_id as string | null) ?? null,
      storage_bucket: bucket,
      storage_path: path,
      mime_type: record.mime_type as string,
      file_size:
        record.file_size == null ? null : Number(record.file_size),
      uploaded_by_user_id:
        (record.uploaded_by_user_id as string | null) ?? null,
      created_at: record.created_at as string,
      signed_url: signed?.signedUrl ?? null,
      work_order_number: wo?.work_order_number ?? null,
    });
  }

  return withUrls;
}

export async function uploadCustomerDocument(
  customerId: string,
  input: { title: string; file: File }
): Promise<CustomerDocument> {
  const user = await requireUser();
  if (!canUploadCustomerDocuments(user.role)) throw new Error("FORBIDDEN");

  const title = input.title.trim();
  if (!title) throw new Error("DOCUMENT_TITLE_REQUIRED");
  if (!(input.file instanceof File) || input.file.size === 0) {
    throw new Error("DOCUMENT_REQUIRED");
  }
  if (input.file.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  if (!ALLOWED_TYPES.has(input.file.type)) {
    throw new Error("DOCUMENT_TYPE_INVALID");
  }

  const supabase = await createClient();
  const { data: customer, error: customerError } = await supabase
    .from("customer")
    .select("customer_id")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  const documentId = crypto.randomUUID();
  const ext = extensionForType(input.file.type);
  const storagePath = `${customerId}/${documentId}.${ext}`;
  const bytes = Buffer.from(await input.file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.file.type,
      upsert: false,
    });

  if (uploadError) throw new Error("DOCUMENT_UPLOAD_FAILED");

  const { data, error } = await supabase
    .from("customer_document")
    .insert({
      document_id: documentId,
      customer_id: customerId,
      title,
      source: "upload",
      work_order_id: null,
      agreement_id: null,
      storage_bucket: UPLOAD_BUCKET,
      storage_path: storagePath,
      mime_type: input.file.type,
      file_size: input.file.size,
      uploaded_by_user_id: user.user_id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    throw error;
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_document_uploaded",
    entity_type: "customer_document",
    entity_id: documentId,
    description: `Uploaded document “${title}” for customer`,
    new_value: { customer_id: customerId, title, mime_type: input.file.type },
  });

  const { data: signed } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(storagePath, 3600);

  return {
    ...(data as Omit<CustomerDocument, "signed_url" | "work_order_number">),
    signed_url: signed?.signedUrl ?? null,
    work_order_number: null,
  };
}

export async function uploadPaperDropOffAgreementCopy(
  workOrderId: string,
  input: { file: File }
): Promise<CustomerDocument> {
  const user = await requireUser();
  if (!canUploadCustomerDocuments(user.role)) throw new Error("FORBIDDEN");

  const file = input.file;
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("DOCUMENT_REQUIRED");
  }
  if (file.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("DOCUMENT_TYPE_INVALID");

  const supabase = await createClient();
  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_order")
    .select("work_order_id, customer_id, location_id, work_order_number")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (workOrderError) throw workOrderError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }

  const { data: agreement, error: agreementError } = await supabase
    .from("drop_off_agreement")
    .select("agreement_id, signature_method, signed_at")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (agreementError) throw agreementError;
  if (!agreement || agreement.signature_method !== "paper") {
    throw new Error("PAPER_AGREEMENT_REQUIRED");
  }

  const { data: existing, error: existingError } = await supabase
    .from("customer_document")
    .select("document_id")
    .eq("agreement_id", agreement.agreement_id)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) throw new Error("PAPER_COPY_ALREADY_UPLOADED");

  const documentId = crypto.randomUUID();
  const ext = extensionForType(file.type);
  const storagePath = `${workOrder.customer_id}/${documentId}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) throw new Error("DOCUMENT_UPLOAD_FAILED");

  const title = dropOffTitle(workOrder.work_order_number, agreement.signed_at);
  const { data, error } = await supabase
    .from("customer_document")
    .insert({
      document_id: documentId,
      customer_id: workOrder.customer_id,
      title,
      source: "drop_off_agreement",
      work_order_id: workOrderId,
      agreement_id: agreement.agreement_id,
      storage_bucket: UPLOAD_BUCKET,
      storage_path: storagePath,
      mime_type: file.type,
      file_size: file.size,
      uploaded_by_user_id: user.user_id,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(UPLOAD_BUCKET).remove([storagePath]);
    if (error.code === "23505") throw new Error("PAPER_COPY_ALREADY_UPLOADED");
    throw error;
  }

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.DROP_OFF_AGREEMENT_COPY_UPLOADED,
    entity_type: "customer_document",
    entity_id: documentId,
    description: "Signed paper drop-off agreement copy uploaded",
    new_value: { mime_type: file.type, storage_path: storagePath },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "paper_drop_off_agreement_copy_uploaded",
    entity_type: "customer_document",
    entity_id: documentId,
    description: `Uploaded signed paper agreement for ${workOrder.work_order_number}`,
    new_value: {
      agreement_id: agreement.agreement_id,
      mime_type: file.type,
      storage_path: storagePath,
    },
  });

  const { data: signed } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(storagePath, 3600);

  return {
    ...(data as Omit<CustomerDocument, "signed_url" | "work_order_number">),
    signed_url: signed?.signedUrl ?? null,
    work_order_number: workOrder.work_order_number,
  };
}

export async function deleteCustomerDocument(
  documentId: string
): Promise<{ customer_id: string }> {
  const user = await requireUser();
  if (!canDeleteCustomerDocuments(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("customer_document")
    .select(COLUMNS)
    .eq("document_id", documentId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) throw new Error("DOCUMENT_NOT_FOUND");

  const { error: deleteError } = await supabase
    .from("customer_document")
    .delete()
    .eq("document_id", documentId);

  if (deleteError) throw deleteError;

  // Contract-signature images stay with the agreement; files in the customer
  // documents bucket (including scanned paper agreements) are owned here.
  if (existing.storage_bucket === UPLOAD_BUCKET) {
    await supabase.storage
      .from(UPLOAD_BUCKET)
      .remove([existing.storage_path as string]);
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_document_deleted",
    entity_type: "customer_document",
    entity_id: documentId,
    description: `Deleted document “${existing.title}” from customer profile`,
    old_value: {
      customer_id: existing.customer_id,
      title: existing.title,
      source: existing.source,
    },
  });

  return { customer_id: existing.customer_id as string };
}
