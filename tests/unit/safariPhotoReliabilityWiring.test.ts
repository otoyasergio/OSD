import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("stateful Safari photo reliability wiring", () => {
  it("lists the spec in STATEFUL_SPECS and every WebKit mutation project", () => {
    const config = source("playwright.config.ts");
    expect(config).toMatch(/safari-photo-reliability\.spec\.ts/);
    expect(config).toMatch(/const STATEFUL_SPECS = \[[\s\S]*safari-photo-reliability/);
    expect(config).toMatch(/name:\s*"webkit-desktop"/);
    expect(config).toMatch(/name:\s*"webkit-ipad-landscape"/);
    expect(config).toMatch(/name:\s*"webkit-ipad-portrait"/);
    expect(config).toMatch(/name:\s*"mobile-phone"/);
    expect(config).toMatch(/workers:\s*allowMutation \? 1/);
    expect(config).toMatch(/testMatch:\s*STATEFUL_SPECS/);
  });

  it("covers offline HEIC enqueue, reopen resume, lightbox, and corrective delete", () => {
    const spec = source("tests/e2e/safari-photo-reliability.spec.ts");
    expect(spec).toMatch(/storageStatePath\("owner"\)/);
    expect(spec).toMatch(/setOffline\(true\)/);
    expect(spec).toMatch(/getByRole\(\s*"heading",\s*\{\s*name:\s*"Upload intake photo"/);
    expect(spec).toMatch(/Navigator\.prototype/);
    expect(spec).toMatch(/dispatchEvent\(\s*new Event\(\s*"offline"/);
    expect(spec).toMatch(/__otomotoPhotoQueue/);
    expect(spec).toMatch(/enqueueIntakeHeic/);
    expect(spec).toMatch(/toString\("base64"\)/);
    expect(spec).toMatch(/sample\.heic/);
    expect(spec).toMatch(/waiting for connection/i);
    const layout = source("app/(app)/layout.tsx");
    expect(layout).toMatch(
      /e2ePhotoQueueHook=\{\s*process\.env\.E2E_ALLOW_MUTATION === "1"/
    );
    const provider = source("components/photos/PhotoUploadQueueProvider.tsx");
    expect(provider).toMatch(/e2ePhotoQueueHook/);
    expect(provider).toMatch(/__otomotoPhotoQueue/);
    expect(provider).toMatch(/prepareQueuedPhotoFromBytes/);
    expect(provider).toMatch(/atob\(/);
    const prepare = source("lib/forms/preparePhotoFileForUpload.ts");
    expect(prepare).toMatch(/isBrowserOffline/);
    const uploader = source("lib/photos/uploadQueue/uploadQueuedPhoto.ts");
    expect(uploader).toMatch(/compressImageForUpload/);
    expect(spec).toMatch(/page\.close\(/);
    expect(spec).toMatch(/newPage\(/);
    expect(spec).toMatch(/getByRole\("dialog"\)|lightbox/i);
    expect(spec).toMatch(/Permanently remove photo|Correction reason/);
    expect(spec).not.toMatch(/reproduces iOS Photos picker/);
  });

  it("scopes the lightbox to the unique-note card and never page-wide .first()", () => {
    const spec = source("tests/e2e/safari-photo-reliability.spec.ts");
    expect(spec).toMatch(/locator\("li"\)\.filter\(\{\s*hasText:\s*note/);
    expect(spec).toMatch(
      /card\.getByRole\(\s*"button",\s*\{\s*name:\s*\/View Other photo full size/
    );
    expect(spec).not.toMatch(
      /getByRole\(\s*"button",\s*\{\s*name:\s*\/View Other photo full size[\s\S]{0,80}\.first\(/
    );
  });

  it("wraps mutations in try/finally with guarded service-role leftover cleanup", () => {
    const spec = source("tests/e2e/safari-photo-reliability.spec.ts");
    expect(spec).toMatch(/assertSafeMutationEnvironment\(/);
    expect(spec).toMatch(/createServiceRoleClient\(/);
    expect(spec).toMatch(/try\s*\{/);
    expect(spec).toMatch(/finally\s*\{/);
    expect(spec).toMatch(/storage_path/);
    expect(spec).toMatch(/thumb_storage_path/);
    expect(spec).toMatch(/intake-photos/);
    expect(spec).toMatch(/setOffline\(false\)/);
    expect(spec).toMatch(/timeout:\s*180_000/);
    expect(spec).toMatch(/findIntakePhotosByNote|notes/);
    expect(spec).toMatch(
      /removeIntakePhotoArtifacts|storage\.from\("intake-photos"\)\.remove/
    );
  });

  it("wires a dedicated script and isolated CI job with mutation guards", () => {
    const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:e2e:safari-photo"]).toMatch(
      /safari-photo-reliability\.spec\.ts/
    );

    const ci = source(".github/workflows/ci.yml");
    expect(ci).toMatch(/PHOTO_UPLOAD_QUEUE_ENABLED:\s*["']?1["']?/);
    expect(ci).toMatch(/CHECKOUT_EVIDENCE_ENABLED:\s*["']?1["']?/);
    expect(ci).toMatch(/test:e2e:safari-photo|safari-photo-reliability/);
    expect(ci).toMatch(/E2E_ALLOW_MUTATION:\s*["']?1["']?/);
    expect(ci).toMatch(/E2E_ENV_GUARD_SECRET/);
    expect(ci).toMatch(/OPENAI_API_KEY:\s*["']?["']?/);
    expect(ci).toMatch(/TWILIO_AUTH_TOKEN:\s*["']?["']?/);
    expect(ci).toMatch(/RESEND_API_KEY:\s*["']?["']?/);
    expect(ci).toMatch(/playwright install --with-deps chromium webkit/);
    expect(ci).toMatch(/TEST_SUPABASE_URL=\$API_URL/);
    expect(ci).toMatch(/TEST_SUPABASE_SERVICE_ROLE_KEY=\$SERVICE_ROLE_KEY/);
    expect(ci).not.toMatch(/continue-on-error:\s*true/);
    expect(ci).not.toMatch(/secrets|sample\.heic|photo bytes/i);
    expect(ci).not.toMatch(/actions\/upload-artifact/);
  });

  it("requires exactly one captured row and zero leftovers after finally cleanup", () => {
    const spec = source("tests/e2e/safari-photo-reliability.spec.ts");
    expect(spec).toMatch(/expect\(captured\)\.toHaveLength\(1\)/);
    expect(spec).toMatch(/assertIntakePhotoRemoved/);
    expect(spec).toMatch(/finally\s*\{/);
    expect(spec).toMatch(
      /findIntakePhotosByNote[\s\S]*removeIntakePhotoArtifacts[\s\S]*toHaveLength\(0\)/
    );
    expect(spec).not.toMatch(/captured\.length\)\.toBeGreaterThan\(0\)/);
  });

  it("verifies captured original and thumb objects are absent after finally cleanup", () => {
    const spec = source("tests/e2e/safari-photo-reliability.spec.ts");
    expect(spec).toMatch(/objectPathsForPhoto|assertIntakePhotoObjectsAbsent/);
    expect(spec).toMatch(/finally\s*\{/);
    expect(spec).toMatch(
      /assertIntakePhotoObjectsAbsent|storage\.from\("intake-photos"\)\.download/
    );
    expect(spec).toMatch(/assertIntakePhotoRemoved/);
    expect(spec).not.toMatch(/captured\.length\)\.toBeGreaterThan\(0\)/);
  });
});
