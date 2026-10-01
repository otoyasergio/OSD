import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ kind: "service-role-client" })),
}));

import { createClient } from "@supabase/supabase-js";
import {
  createAdminClient,
  createDiagnosticsAdminClient,
  createPhotoAdminClient,
} from "@/lib/database/supabase-admin";

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.clearAllMocks();
});

describe("server service-role Supabase clients", () => {
  it("is marked server-only and stays aliased in unit tests", () => {
    const admin = readFileSync(
      join(process.cwd(), "lib", "database", "supabase-admin.ts"),
      "utf8"
    );
    expect(admin).toMatch(/^import ["']server-only["'];/m);
    const config = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");
    expect(config).toMatch(
      /"server-only":\s*path\.resolve\(__dirname,\s*"node_modules\/server-only\/empty\.js"\)/
    );
  });

  it("preserves the existing admin-client configuration error", () => {
    expect(() => createAdminClient()).toThrow("PARTS_CANADA_SYNC_MISCONFIGURED");
  });

  it("uses a diagnostics-specific configuration error", () => {
    expect(() => createDiagnosticsAdminClient()).toThrow(
      "ASK_OTOMOTO_DIAGNOSTICS_MISCONFIGURED"
    );
  });

  it("uses a photo-specific configuration error for the reconciler client", () => {
    expect(() => createPhotoAdminClient()).toThrow("PHOTO_ADMIN_MISCONFIGURED");
  });

  it("trims photo admin URL and key and rejects whitespace-only config", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "   ";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "  service-role-secret  ";
    expect(() => createPhotoAdminClient()).toThrow("PHOTO_ADMIN_MISCONFIGURED");

    process.env.NEXT_PUBLIC_SUPABASE_URL = "  https://example.supabase.co  ";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "  service-role-secret  ";
    expect(createPhotoAdminClient()).toEqual({
      kind: "service-role-client",
    });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-secret",
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  });

  it("creates a non-persisting photo service-role client", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(createPhotoAdminClient()).toEqual({
      kind: "service-role-client",
    });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-secret",
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  });

  it("creates a non-persisting diagnostics service-role client", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(createDiagnosticsAdminClient()).toEqual({
      kind: "service-role-client",
    });
    expect(createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-secret",
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );
  });
});
