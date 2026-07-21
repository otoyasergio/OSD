import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageStaffProfiles } from "@/lib/permissions";
import {
  computeRetentionUntil,
  isStaffDocumentCategory,
  type StaffDocumentCategory,
} from "@/lib/services/staffDocumentRetention";

const DOC_BUCKET = "staff-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type StaffEmploymentRecord = {
  user_id: string;
  legal_name: string | null;
  home_address: string | null;
  employment_start_date: string | null;
  date_of_birth: string | null;
  employment_end_date: string | null;
  job_title: string | null;
  regular_work_day_hours: number | null;
  regular_work_week_hours: number | null;
  pay_type: "hourly" | "salary" | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  updated_at: string;
  updated_by_user_id: string | null;
};

export type StaffNote = {
  note_id: string;
  user_id: string;
  body: string;
  created_by_user_id: string | null;
  created_at: string;
  voided_at: string | null;
};

export type StaffDocument = {
  document_id: string;
  user_id: string;
  title: string;
  category: StaffDocumentCategory;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_size: number | null;
  uploaded_by_user_id: string | null;
  created_at: string;
  retention_until: string | null;
  voided_at: string | null;
  signed_url: string | null;
};

export type StaffProfileUser = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  status: string;
  has_time_clock_pin: boolean;
};

const EMPLOYMENT_COLUMNS =
  "user_id, legal_name, home_address, employment_start_date, date_of_birth, employment_end_date, job_title, regular_work_day_hours, regular_work_week_hours, pay_type, emergency_contact_name, emergency_contact_phone, updated_at, updated_by_user_id";

const NOTE_COLUMNS = "note_id, user_id, body, created_by_user_id, created_at, voided_at";

const DOC_COLUMNS =
  "document_id, user_id, title, category, storage_bucket, storage_path, mime_type, file_size, uploaded_by_user_id, created_at, retention_until, voided_at";

async function requireStaffManager() {
  const user = await requireUser();
  if (!canManageStaffProfiles(user.role)) throw new Error("FORBIDDEN");
  return user;
}

function extensionForType(type: string): string {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export async function getStaffProfileUser(userId: string): Promise<StaffProfileUser> {
  await requireStaffManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, email, role, status, time_clock_pin_hash")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("USER_NOT_FOUND");
  return {
    user_id: data.user_id,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    role: data.role,
    status: data.status,
    has_time_clock_pin: Boolean(data.time_clock_pin_hash),
  };
}

export async function getStaffEmploymentRecord(
  userId: string
): Promise<StaffEmploymentRecord | null> {
  await requireStaffManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_employment_record")
    .select(EMPLOYMENT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    ...(data as Omit<
      StaffEmploymentRecord,
      "pay_type" | "regular_work_day_hours" | "regular_work_week_hours"
    >),
    pay_type:
      data.pay_type === "hourly" || data.pay_type === "salary" ? data.pay_type : null,
    regular_work_day_hours:
      data.regular_work_day_hours == null ? null : Number(data.regular_work_day_hours),
    regular_work_week_hours:
      data.regular_work_week_hours == null ? null : Number(data.regular_work_week_hours),
  };
}

export async function upsertStaffEmploymentRecord(
  userId: string,
  input: {
    legal_name?: string | null;
    home_address?: string | null;
    employment_start_date?: string | null;
    date_of_birth?: string | null;
    employment_end_date?: string | null;
    job_title?: string | null;
    regular_work_day_hours?: number | null;
    regular_work_week_hours?: number | null;
    pay_type?: "hourly" | "salary" | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
  }
): Promise<StaffEmploymentRecord> {
  const actor = await requireStaffManager();
  const supabase = await createClient();

  const { data: staff, error: staffError } = await supabase
    .from("app_user")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (staffError) throw staffError;
  if (!staff) throw new Error("USER_NOT_FOUND");

  const row = {
    user_id: userId,
    legal_name: input.legal_name?.trim() || null,
    home_address: input.home_address?.trim() || null,
    employment_start_date: input.employment_start_date?.trim() || null,
    date_of_birth: input.date_of_birth?.trim() || null,
    employment_end_date: input.employment_end_date?.trim() || null,
    job_title: input.job_title?.trim() || null,
    regular_work_day_hours: input.regular_work_day_hours ?? null,
    regular_work_week_hours: input.regular_work_week_hours ?? null,
    pay_type: input.pay_type ?? null,
    emergency_contact_name: input.emergency_contact_name?.trim() || null,
    emergency_contact_phone: input.emergency_contact_phone?.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by_user_id: actor.user_id,
  };

  const { data, error } = await supabase
    .from("staff_employment_record")
    .upsert(row, { onConflict: "user_id" })
    .select(EMPLOYMENT_COLUMNS)
    .single();
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "staff_employment_upsert",
    entity_type: "staff_employment_record",
    entity_id: userId,
    description: `${actor.first_name} ${actor.last_name} updated employment record`,
    new_value: data,
  });

  return (await getStaffEmploymentRecord(userId))!;
}

export async function listStaffNotes(userId: string): Promise<StaffNote[]> {
  await requireStaffManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_note")
    .select(NOTE_COLUMNS)
    .eq("user_id", userId)
    .is("voided_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StaffNote[];
}

export async function addStaffNote(userId: string, body: string): Promise<StaffNote> {
  const actor = await requireStaffManager();
  const trimmed = body.trim();
  if (!trimmed) throw new Error("NOTE_REQUIRED");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_note")
    .insert({
      user_id: userId,
      body: trimmed,
      created_by_user_id: actor.user_id,
    })
    .select(NOTE_COLUMNS)
    .single();
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "staff_note_add",
    entity_type: "staff_note",
    entity_id: data.note_id,
    description: `${actor.first_name} ${actor.last_name} added a staff note`,
    new_value: data,
  });

  return data as StaffNote;
}

export async function voidStaffNote(noteId: string): Promise<void> {
  const actor = await requireStaffManager();
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("staff_note")
    .select(NOTE_COLUMNS)
    .eq("note_id", noteId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing || existing.voided_at) throw new Error("NOTE_NOT_FOUND");

  const voidedAt = new Date().toISOString();
  const { error } = await supabase
    .from("staff_note")
    .update({ voided_at: voidedAt })
    .eq("note_id", noteId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "staff_note_void",
    entity_type: "staff_note",
    entity_id: noteId,
    description: `${actor.first_name} ${actor.last_name} voided a staff note`,
    old_value: existing,
  });
}

export async function listStaffDocuments(userId: string): Promise<StaffDocument[]> {
  await requireStaffManager();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_document")
    .select(DOC_COLUMNS)
    .eq("user_id", userId)
    .is("voided_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows: StaffDocument[] = [];
  for (const row of data ?? []) {
    const { data: signed } = await supabase.storage
      .from(row.storage_bucket)
      .createSignedUrl(row.storage_path, 3600);
    rows.push({
      document_id: row.document_id,
      user_id: row.user_id,
      title: row.title,
      category: row.category as StaffDocumentCategory,
      storage_bucket: row.storage_bucket,
      storage_path: row.storage_path,
      mime_type: row.mime_type,
      file_size: row.file_size == null ? null : Number(row.file_size),
      uploaded_by_user_id: row.uploaded_by_user_id,
      created_at: row.created_at,
      retention_until: row.retention_until,
      voided_at: row.voided_at,
      signed_url: signed?.signedUrl ?? null,
    });
  }
  return rows;
}

export async function uploadStaffDocument(
  userId: string,
  input: { title: string; category: string; file: File }
): Promise<StaffDocument> {
  const actor = await requireStaffManager();
  const title = input.title.trim();
  if (!title) throw new Error("DOCUMENT_TITLE_REQUIRED");
  if (!isStaffDocumentCategory(input.category)) {
    throw new Error("DOCUMENT_CATEGORY_INVALID");
  }
  if (!(input.file instanceof File) || input.file.size === 0) {
    throw new Error("DOCUMENT_REQUIRED");
  }
  if (input.file.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  if (!ALLOWED_TYPES.has(input.file.type)) {
    throw new Error("DOCUMENT_TYPE_INVALID");
  }

  const supabase = await createClient();
  const employment = await getStaffEmploymentRecord(userId);
  const createdAt = new Date();
  const retention = computeRetentionUntil(input.category, createdAt, {
    employmentEndDate: employment?.employment_end_date
      ? new Date(`${employment.employment_end_date}T12:00:00Z`)
      : null,
  });

  const documentId = crypto.randomUUID();
  const ext = extensionForType(input.file.type);
  const storagePath = `${userId}/${documentId}.${ext}`;
  const bytes = Buffer.from(await input.file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOC_BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.file.type,
      upsert: false,
    });
  if (uploadError) throw new Error("DOCUMENT_UPLOAD_FAILED");

  const { data, error } = await supabase
    .from("staff_document")
    .insert({
      document_id: documentId,
      user_id: userId,
      title,
      category: input.category,
      storage_bucket: DOC_BUCKET,
      storage_path: storagePath,
      mime_type: input.file.type,
      file_size: input.file.size,
      uploaded_by_user_id: actor.user_id,
      retention_until: retention.toISOString().slice(0, 10),
    })
    .select(DOC_COLUMNS)
    .single();
  if (error) {
    await supabase.storage.from(DOC_BUCKET).remove([storagePath]);
    throw error;
  }

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "staff_document_upload",
    entity_type: "staff_document",
    entity_id: documentId,
    description: `${actor.first_name} ${actor.last_name} uploaded staff document`,
    new_value: data,
  });

  const { data: signed } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrl(storagePath, 3600);

  return {
    document_id: data.document_id,
    user_id: data.user_id,
    title: data.title,
    category: data.category as StaffDocumentCategory,
    storage_bucket: data.storage_bucket,
    storage_path: data.storage_path,
    mime_type: data.mime_type,
    file_size: data.file_size == null ? null : Number(data.file_size),
    uploaded_by_user_id: data.uploaded_by_user_id,
    created_at: data.created_at,
    retention_until: data.retention_until,
    voided_at: data.voided_at,
    signed_url: signed?.signedUrl ?? null,
  };
}

export async function voidStaffDocument(documentId: string): Promise<void> {
  const actor = await requireStaffManager();
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("staff_document")
    .select(DOC_COLUMNS)
    .eq("document_id", documentId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing || existing.voided_at) throw new Error("DOCUMENT_NOT_FOUND");

  const voidedAt = new Date().toISOString();
  const { error } = await supabase
    .from("staff_document")
    .update({ voided_at: voidedAt })
    .eq("document_id", documentId);
  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: actor.user_id,
    location_id: actor.active_location_id,
    action: "staff_document_void",
    entity_type: "staff_document",
    entity_id: documentId,
    description: `${actor.first_name} ${actor.last_name} voided a staff document`,
    old_value: existing,
  });
}
