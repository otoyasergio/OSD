#!/usr/bin/env node
/**
 * Read-only deploy gate: confirm PostgREST already exposes the photo schema
 * this release needs. Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Never prints secrets.
 *
 *   node scripts/check-photo-schema.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_INTAKE_PHOTO_COLUMNS = [
  "photo_id",
  "work_order_id",
  "storage_path",
  "thumb_storage_path",
  "category",
  "client_upload_id",
  "content_type",
  "byte_size",
  "pixel_width",
  "pixel_height",
  "notes",
  "inspection_result_id",
  "job_id",
  "uploaded_by_user_id",
];

export const REQUIRED_WORK_ORDER_COLUMNS = [
  "status",
  "quality_checked_at",
  "quality_checked_by_user_id",
  "checkout_evidence_required",
  "checkout_evidence_override_at",
  "checkout_evidence_override_by_user_id",
  "checkout_evidence_override_reason",
];

export const REQUIRED_RPC_PATH = "/rpc/create_intake_photo_with_event";

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function readPhotoSchemaConfig(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("PHOTO_SCHEMA_CHECK_MISCONFIGURED");
  }
  return { url: url.replace(/\/$/, ""), key };
}

function schemaProperties(spec, name) {
  const definitions = spec?.definitions ?? spec?.components?.schemas ?? {};
  return definitions[name]?.properties ?? {};
}

export function inspectPhotoOpenApi(spec) {
  const missing = [];
  const paths = spec?.paths ?? {};
  const intake = schemaProperties(spec, "intake_photo");
  const workOrder = schemaProperties(spec, "work_order");

  if (!paths["/intake_photo"] && !paths.intake_photo) {
    missing.push("path:/intake_photo");
  }
  if (!paths["/work_order"] && !paths.work_order) {
    missing.push("path:/work_order");
  }
  if (!paths[REQUIRED_RPC_PATH] && !paths["rpc/create_intake_photo_with_event"]) {
    missing.push(REQUIRED_RPC_PATH);
  }

  for (const column of REQUIRED_INTAKE_PHOTO_COLUMNS) {
    if (!(column in intake)) missing.push(`intake_photo.${column}`);
  }
  for (const column of REQUIRED_WORK_ORDER_COLUMNS) {
    if (!(column in workOrder)) missing.push(`work_order.${column}`);
  }

  return { ok: missing.length === 0, missing };
}

function redact(text, secret) {
  const raw = String(text ?? "");
  if (!secret) return raw;
  return raw.split(secret).join("[redacted]");
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   fetchFn?: (input: string, init?: { headers?: Record<string, string> }) => Promise<{
 *     ok: boolean,
 *     status: number,
 *     json: () => Promise<unknown>,
 *   }>,
 *   log?: (message: string) => void,
 * }} [options]
 */
export async function checkPhotoSchema({
  env = process.env,
  fetchFn = globalThis.fetch,
  log = console.log,
} = {}) {
  let config;
  try {
    config = readPhotoSchemaConfig(env);
  } catch (error) {
    log(error instanceof Error ? error.message : "PHOTO_SCHEMA_CHECK_MISCONFIGURED");
    return 1;
  }

  try {
    const response = await fetchFn(`${config.url}/rest/v1/`, {
      headers: {
        Accept: "application/openapi+json",
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    });
    if (!response.ok) {
      log(`PHOTO_SCHEMA_CHECK_FAILED status ${response.status}`);
      return 1;
    }
    const spec = await response.json();
    const result = inspectPhotoOpenApi(spec);
    if (!result.ok) {
      log(`PHOTO_SCHEMA_CHECK_FAILED missing ${result.missing.join(", ")}`);
      return 1;
    }
    log("Photo schema check passed.");
    return 0;
  } catch (error) {
    const message = redact(
      error instanceof Error ? error.message : "unknown error",
      config.key
    );
    log(`PHOTO_SCHEMA_CHECK_FAILED ${message}`);
    return 1;
  }
}

function isExecutedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  checkPhotoSchema().then((code) => process.exit(code));
}
