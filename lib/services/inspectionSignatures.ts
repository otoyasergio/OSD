import type { DbClient } from "@/lib/database/types";

export const INSPECTION_SIGNATURE_BUCKET = "inspection-signatures";
export const INSPECTION_SIGNATURE_MAX_BYTES = 5 * 1024 * 1024;

export type InspectionSignatureKind = "arrival" | "qc" | "final";

export type ParsedSignatureDataUrl = {
  ext: "png" | "jpg";
  contentType: "image/png" | "image/jpeg";
  bytes: Buffer;
};

/**
 * Parse a canvas data URL into bytes for storage upload.
 * Throws SIGNATURE_INVALID / SIGNATURE_TOO_LARGE.
 */
export function parseSignatureDataUrl(dataUrl: string): ParsedSignatureDataUrl {
  const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) throw new Error("SIGNATURE_INVALID");

  const ext = match[1] === "jpeg" ? "jpg" : "png";
  const contentType = match[1] === "jpeg" ? "image/jpeg" : "image/png";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) throw new Error("SIGNATURE_REQUIRED");
  if (bytes.length > INSPECTION_SIGNATURE_MAX_BYTES) {
    throw new Error("SIGNATURE_TOO_LARGE");
  }

  return { ext, contentType, bytes };
}

export function inspectionSignatureStoragePath(input: {
  locationId: string;
  workOrderId: string;
  kind: InspectionSignatureKind;
  ext: "png" | "jpg";
}): string {
  return `${input.locationId}/${input.workOrderId}/${input.kind}/${crypto.randomUUID()}.${input.ext}`;
}

/**
 * Upload a drawn signature PNG/JPEG to the inspection-signatures bucket.
 * Returns the storage path. Caller should remove the object if the DB write fails.
 */
export async function uploadInspectionSignature(
  supabase: DbClient,
  input: {
    locationId: string;
    workOrderId: string;
    kind: InspectionSignatureKind;
    signatureDataUrl: string;
  }
): Promise<string> {
  const trimmed = input.signatureDataUrl?.trim() ?? "";
  if (!trimmed) throw new Error("SIGNATURE_REQUIRED");

  const parsed = parseSignatureDataUrl(trimmed);
  const storagePath = inspectionSignatureStoragePath({
    locationId: input.locationId,
    workOrderId: input.workOrderId,
    kind: input.kind,
    ext: parsed.ext,
  });

  const { error: uploadError } = await supabase.storage
    .from(INSPECTION_SIGNATURE_BUCKET)
    .upload(storagePath, parsed.bytes, {
      contentType: parsed.contentType,
      upsert: false,
    });

  if (uploadError) throw new Error("SIGNATURE_UPLOAD_FAILED");
  return storagePath;
}

export async function removeInspectionSignature(
  supabase: DbClient,
  storagePath: string
): Promise<void> {
  await supabase.storage.from(INSPECTION_SIGNATURE_BUCKET).remove([storagePath]);
}

export async function createInspectionSignatureSignedUrl(
  supabase: DbClient,
  storagePath: string | null | undefined,
  expiresIn = 3600
): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from(INSPECTION_SIGNATURE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) return null;
  return data.signedUrl;
}
