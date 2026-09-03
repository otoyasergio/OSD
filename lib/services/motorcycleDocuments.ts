import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import {
  canDeleteMotorcycleDocuments,
  canUploadMotorcycleDocuments,
  canViewMotorcycleDocuments,
} from "@/lib/permissions";

export type MotorcycleDocument = {
  document_id: string;
  motorcycle_id: string;
  title: string;
  notes: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size: number | null;
  uploaded_by_user_id: string | null;
  created_at: string;
  signed_url: string | null;
};

const UPLOAD_BUCKET = "motorcycle-documents";
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
  "document_id, motorcycle_id, title, notes, storage_bucket, storage_path, mime_type, file_size, uploaded_by_user_id, created_at";

function extensionForType(type: string): string {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic" || type === "image/heif") return "heic";
  return "jpg";
}

async function signDocumentPaths(
  supabase: DbClient,
  paths: string[],
  expiresInSeconds = 60 * 60
): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const byPath = new Map<string, string | null>();
  if (unique.length === 0) return byPath;

  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrls(unique, expiresInSeconds);

  if (error || !data) {
    for (const path of unique) byPath.set(path, null);
    return byPath;
  }

  for (const row of data) {
    if (row.path) byPath.set(row.path, row.signedUrl ?? null);
  }
  return byPath;
}

export async function listMotorcycleDocuments(
  motorcycleId: string
): Promise<MotorcycleDocument[]> {
  const user = await requireUser();
  if (!canViewMotorcycleDocuments(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("motorcycle_document")
    .select(COLUMNS)
    .eq("motorcycle_id", motorcycleId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as Array<{
    document_id: string;
    motorcycle_id: string;
    title: string;
    notes: string | null;
    storage_bucket: string;
    storage_path: string;
    mime_type: string;
    file_size: number | null;
    uploaded_by_user_id: string | null;
    created_at: string;
  }>;

  const signed = await signDocumentPaths(
    supabase,
    rows.map((row) => row.storage_path)
  );

  return rows.map((row) => ({
    ...row,
    file_size: row.file_size == null ? null : Number(row.file_size),
    signed_url: signed.get(row.storage_path) ?? null,
  }));
}

export async function uploadMotorcycleDocument(
  motorcycleId: string,
  input: { title: string; notes?: string | null; file: File }
): Promise<MotorcycleDocument> {
  const user = await requireUser();
  if (!canUploadMotorcycleDocuments(user.role)) throw new Error("FORBIDDEN");

  const title = input.title.trim() || "Document photo";
  const notes = input.notes?.trim() || null;
  if (!(input.file instanceof File) || input.file.size === 0) {
    throw new Error("DOCUMENT_REQUIRED");
  }
  if (input.file.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  if (input.file.type && !ALLOWED_TYPES.has(input.file.type)) {
    throw new Error("DOCUMENT_TYPE_INVALID");
  }

  const supabase = await createClient();
  const { data: motorcycle, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select("motorcycle_id")
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();

  if (motorcycleError) throw motorcycleError;
  if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");

  const documentId = crypto.randomUUID();
  const ext = extensionForType(input.file.type || "image/jpeg");
  const storagePath = `${motorcycleId}/${documentId}.${ext}`;
  const mimeType = input.file.type || "image/jpeg";
  const bytes = Buffer.from(await input.file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) throw new Error("DOCUMENT_UPLOAD_FAILED");

  const { data, error } = await supabase
    .from("motorcycle_document")
    .insert({
      document_id: documentId,
      motorcycle_id: motorcycleId,
      title,
      notes,
      storage_bucket: UPLOAD_BUCKET,
      storage_path: storagePath,
      mime_type: mimeType,
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
    action: "motorcycle_document_uploaded",
    entity_type: "motorcycle_document",
    entity_id: documentId,
    description: `Uploaded document “${title}” for motorcycle`,
    new_value: { motorcycle_id: motorcycleId, title, mime_type: mimeType },
  });

  const { data: signed } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(storagePath, 3600);

  return {
    ...(data as Omit<MotorcycleDocument, "signed_url">),
    file_size: data.file_size == null ? null : Number(data.file_size as number | string),
    signed_url: signed?.signedUrl ?? null,
  };
}

export async function deleteMotorcycleDocument(
  documentId: string
): Promise<{ motorcycle_id: string }> {
  const user = await requireUser();
  if (!canDeleteMotorcycleDocuments(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("motorcycle_document")
    .select(COLUMNS)
    .eq("document_id", documentId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) throw new Error("DOCUMENT_NOT_FOUND");

  const { error: deleteError } = await supabase
    .from("motorcycle_document")
    .delete()
    .eq("document_id", documentId);

  if (deleteError) throw deleteError;

  if (existing.storage_bucket === UPLOAD_BUCKET) {
    await supabase.storage.from(UPLOAD_BUCKET).remove([existing.storage_path as string]);
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "motorcycle_document_deleted",
    entity_type: "motorcycle_document",
    entity_id: documentId,
    description: `Deleted document “${existing.title}” from motorcycle profile`,
    old_value: {
      motorcycle_id: existing.motorcycle_id,
      title: existing.title,
    },
  });

  return { motorcycle_id: existing.motorcycle_id as string };
}
