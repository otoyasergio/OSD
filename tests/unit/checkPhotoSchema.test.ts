import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkPhotoSchema,
  inspectPhotoOpenApi,
  readPhotoSchemaConfig,
} from "../../scripts/check-photo-schema.mjs";

const SERVICE_ROLE = "service-role-secret-value-do-not-print";
const URL = "https://example.supabase.co";

function completeSpec() {
  return {
    swagger: "2.0",
    paths: {
      "/intake_photo": { get: {} },
      "/work_order": { get: {} },
      "/rpc/create_intake_photo_with_event": { post: {} },
    },
    definitions: {
      intake_photo: {
        properties: {
          photo_id: {},
          work_order_id: {},
          storage_path: {},
          thumb_storage_path: {},
          category: {},
          client_upload_id: {},
          content_type: {},
          byte_size: {},
          pixel_width: {},
          pixel_height: {},
          notes: {},
          inspection_result_id: {},
          job_id: {},
          uploaded_by_user_id: {},
        },
      },
      work_order: {
        properties: {
          status: {},
          quality_checked_at: {},
          quality_checked_by_user_id: {},
          checkout_evidence_required: {},
          checkout_evidence_override_at: {},
          checkout_evidence_override_by_user_id: {},
          checkout_evidence_override_reason: {},
        },
      },
    },
  };
}

describe("check-photo-schema", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a complete PostgREST OpenAPI document", () => {
    const result = inspectPhotoOpenApi(completeSpec());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("reports missing intake_photo columns, work_order columns, and the atomic RPC", () => {
    const result = inspectPhotoOpenApi({
      swagger: "2.0",
      paths: { "/intake_photo": { get: {} } },
      definitions: {
        intake_photo: { properties: { photo_id: {} } },
        work_order: { properties: { status: {} } },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.missing.join("\n")).toMatch(/storage_path|client_upload_id/);
    expect(result.missing.join("\n")).toMatch(
      /checkout_evidence_required|quality_checked_at/
    );
    expect(result.missing.join("\n")).toMatch(/create_intake_photo_with_event/);
  });

  it("requires configured URL and service-role without printing secrets", () => {
    expect(() => readPhotoSchemaConfig({})).toThrow(
      /PHOTO_SCHEMA_CHECK_MISCONFIGURED|PHOTO_ADMIN_MISCONFIGURED/
    );
    expect(() =>
      readPhotoSchemaConfig({
        NEXT_PUBLIC_SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      })
    ).not.toThrow();
    expect(() =>
      readPhotoSchemaConfig({
        NEXT_PUBLIC_SUPABASE_URL: "   ",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      })
    ).toThrow();
  });

  it("fetches OpenAPI with the service role and exits 0 when complete", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => completeSpec(),
      text: async () => JSON.stringify(completeSpec()),
    }));
    const logs: string[] = [];
    const code = await checkPhotoSchema({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      },
      fetchFn,
      log: (message: string) => logs.push(message),
    });
    expect(code).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const request = fetchFn.mock.calls[0] as unknown as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(String(request[0])).toMatch(/\/rest\/v1\/?/);
    expect(JSON.stringify(logs)).not.toContain(SERVICE_ROLE);
  });

  it("exits nonzero on fetch or parse errors without printing the service role", async () => {
    const logs: string[] = [];
    const code = await checkPhotoSchema({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      },
      fetchFn: async () => {
        throw new Error(`upstream ${SERVICE_ROLE}`);
      },
      log: (message: string) => logs.push(message),
    });
    expect(code).toBe(1);
    expect(logs.join("\n")).not.toContain(SERVICE_ROLE);
    expect(logs.join("\n")).toMatch(/PHOTO_SCHEMA_CHECK_FAILED|schema/i);
  });

  it("exits nonzero when config is missing", async () => {
    const logs: string[] = [];
    const code = await checkPhotoSchema({
      env: {},
      fetchFn: vi.fn(),
      log: (message: string) => logs.push(message),
    });
    expect(code).toBe(1);
    expect(logs.join("\n")).toMatch(
      /PHOTO_SCHEMA_CHECK_MISCONFIGURED|PHOTO_ADMIN_MISCONFIGURED/
    );
  });

  it("runs after the main-branch guard and before Vercel in deploy:production", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const deploy = pkg.scripts["deploy:production"];
    expect(deploy).toMatch(/guard-prod-deploy\.mjs/);
    expect(deploy).toMatch(/check-photo-schema\.mjs/);
    expect(deploy.indexOf("guard-prod-deploy.mjs")).toBeLessThan(
      deploy.indexOf("check-photo-schema.mjs")
    );
    expect(deploy.indexOf("check-photo-schema.mjs")).toBeLessThan(
      deploy.indexOf("vercel")
    );
  });
});
