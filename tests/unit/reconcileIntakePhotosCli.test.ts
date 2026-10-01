import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  formatPhotoReconcileOutput,
  parsePhotoReconcileArgs,
  requirePhotoReconcileConfig,
  runPhotoReconcileCli,
} from "@/lib/photos/reconcileIntakePhotosCli";
import type { PhotoReconcileReport } from "@/lib/photos/reconcileIntakePhotos";

const SERVICE_ROLE = "service-role-secret-key-do-not-print";
const SIGNED_URL = "https://signed.example/intake/front.jpg?token=abc";

function sampleReport(): PhotoReconcileReport {
  return {
    missingOriginals: [
      { photoId: "photo-b", storagePath: "wo/front/b.jpg" },
      { photoId: "photo-a", storagePath: "wo/front/a.jpg" },
    ],
    missingThumbnails: [{ photoId: "photo-c", thumbStoragePath: "wo/rear/c.thumb.jpg" }],
    nullThumbnails: [{ photoId: "photo-d", storagePath: "wo/vin/d.jpg" }],
    orphans: [{ path: "wo/other/orphan.jpg" }],
    repaired: 1,
    failed: 1,
    failures: [{ photoId: "photo-c", reason: "generate" }],
    counts: {
      rows: 4,
      objects: 5,
      missingOriginals: 2,
      missingThumbnails: 1,
      nullThumbnails: 1,
      orphans: 1,
      repaired: 1,
      failed: 1,
    },
  };
}

describe("photo reconcile CLI parsing and output", () => {
  it("parses repair and json flags", () => {
    expect(parsePhotoReconcileArgs([])).toEqual({
      repairThumbnails: false,
      json: false,
    });
    expect(parsePhotoReconcileArgs(["--repair-thumbnails", "--json"])).toEqual({
      repairThumbnails: true,
      json: true,
    });
  });

  it("requires URL and service role without leaking the key", () => {
    expect(() => requirePhotoReconcileConfig({})).toThrow("PHOTO_ADMIN_MISCONFIGURED");
    expect(() =>
      requirePhotoReconcileConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      })
    ).not.toThrow();
    try {
      requirePhotoReconcileConfig({
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      });
    } catch (error) {
      expect(String(error)).not.toContain(SERVICE_ROLE);
    }
  });

  it("prints deterministic JSON without secrets or signed URLs", () => {
    const json = formatPhotoReconcileOutput(sampleReport(), { json: true });
    const first = JSON.parse(json) as PhotoReconcileReport;
    const second = JSON.parse(formatPhotoReconcileOutput(sampleReport(), { json: true }));
    expect(first).toEqual(second);
    expect(first.missingOriginals.map((item) => item.photoId)).toEqual([
      "photo-a",
      "photo-b",
    ]);
    expect(json).not.toContain(SERVICE_ROLE);
    expect(json).not.toContain(SIGNED_URL);
    expect(json).not.toContain("Ada");
    expect(json).not.toContain("token=");
  });

  it("prints concise human output with counts and ids only", () => {
    const text = formatPhotoReconcileOutput(sampleReport(), { json: false });
    expect(text).toMatch(/Missing originals:\s*2/i);
    expect(text).toMatch(/photo-a/);
    expect(text).toMatch(/wo\/front\/a\.jpg/);
    expect(text).toMatch(/Orphans:\s*1/i);
    expect(text).toMatch(/Repaired:\s*1/i);
    expect(text).not.toContain(SIGNED_URL);
    expect(text).not.toContain(SERVICE_ROLE);
    expect(text).not.toMatch(/customer|Ada|signed\.example/i);
  });

  it("runs report-only by default and never deletes", async () => {
    const writes: string[] = [];
    const reconcile = vi.fn(async () => sampleReport());
    const removeObject = vi.fn();
    const createClient = vi.fn(() => ({ kind: "photo-admin" }));

    const code = await runPhotoReconcileCli({
      argv: ["--json"],
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
      },
      write: (text) => writes.push(text),
      createClient,
      reconcile,
    });

    expect(code).toBe(0);
    expect(reconcile).toHaveBeenCalledWith(
      { kind: "photo-admin" },
      { repairThumbnails: false }
    );
    expect(removeObject).not.toHaveBeenCalled();
    expect(writes.join("")).not.toContain(SERVICE_ROLE);
    expect(writes.join("")).toContain('"missingOriginals"');
  });

  it("keeps the npm script and runner free of client exposure", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["photos:reconcile"]).toMatch(/reconcile-intake-photos/);
    const runner = readFileSync(
      join(process.cwd(), "scripts", "reconcile-intake-photos.ts"),
      "utf8"
    );
    expect(runner).toMatch(/createPhotoAdminClient/);
    expect(runner).not.toMatch(/console\.log\(process\.env/);
    expect(runner).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
