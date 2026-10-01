import { spawn } from "node:child_process";
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

  it("lists each failed photoId and a safe reason in human repair output", () => {
    const leaky = {
      ...sampleReport(),
      failed: 2,
      failures: [
        { photoId: "photo-c", reason: "generate" },
        {
          photoId: "photo-e",
          reason: `download ${SIGNED_URL} for Ada Customer token=abc`,
        },
      ],
      counts: { ...sampleReport().counts, failed: 2 },
    };
    const text = formatPhotoReconcileOutput(leaky, { json: false });
    expect(text).toMatch(/Failed:\s*2/i);
    expect(text).toMatch(/photo-c\s+generate/);
    expect(text).toMatch(/photo-e\s+/);
    expect(text).not.toContain(SIGNED_URL);
    expect(text).not.toContain("token=abc");
    expect(text).not.toContain("Ada Customer");
    expect(text).not.toMatch(/https?:\/\//i);
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
    expect(pkg.scripts["photos:reconcile"]).toMatch(/--env-file-if-exists=\.env\.local/);
    expect(pkg.scripts["photos:reconcile"]).toMatch(/^tsx /);
    expect(pkg.scripts["photos:reconcile"]).not.toMatch(/npx/);
    const runner = readFileSync(
      join(process.cwd(), "scripts", "reconcile-intake-photos.ts"),
      "utf8"
    );
    expect(runner).toMatch(/createPhotoAdminClient/);
    expect(runner).not.toMatch(/console\.log\(process\.env/);
    expect(runner).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(runner).not.toMatch(/canonicalizeIntakePhoto|server-only/);
    const service = readFileSync(
      join(process.cwd(), "lib", "photos", "reconcileIntakePhotos.ts"),
      "utf8"
    );
    expect(service).toMatch(/makeIntakeThumb/);
    expect(service).not.toMatch(/canonicalizeIntakePhoto|makeCanonicalIntakeThumbnail/);
    expect(service).not.toMatch(/server-only/);
  });

  it("npm run photos:reconcile -- --json reaches PHOTO_ADMIN_MISCONFIGURED without server-only", async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("npm", ["run", "photos:reconcile", "--", "--json"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: "",
          SUPABASE_SERVICE_ROLE_KEY: "",
          TEST_SUPABASE_URL: "",
          TEST_SUPABASE_SERVICE_ROLE_KEY: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve(`code=${code}\n${stdout}\n${stderr}`);
      });
    });

    expect(output).toMatch(/PHOTO_ADMIN_MISCONFIGURED/);
    expect(output).not.toMatch(/server-only/i);
    expect(output).not.toMatch(/This module cannot be imported from a Client Component/i);
    expect(output).not.toContain(SERVICE_ROLE);
    expect(output).not.toMatch(/https:\/\/signed\.example/);
  }, 60000);
});
