import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("durable photo queue flag wiring", () => {
  it("documents PHOTO_UPLOAD_QUEUE_ENABLED in the env example independently of checkout", () => {
    const env = source(".env.local.example");
    expect(env).toMatch(/PHOTO_UPLOAD_QUEUE_ENABLED=/);
    expect(env).toMatch(/CHECKOUT_EVIDENCE_ENABLED=/);
    expect(env.indexOf("PHOTO_UPLOAD_QUEUE_ENABLED=")).toBeLessThan(
      env.indexOf("CHECKOUT_EVIDENCE_ENABLED=")
    );
    expect(env).toMatch(/Roll this flag first/i);
  });

  it("passes the server flag into AppShell and Account queue providers keyed by mode", () => {
    const layout = source("app/(app)/layout.tsx");
    const account = source("app/account/page.tsx");
    const appShell = source("components/layout/AppShell.tsx");
    const accountScope = source("components/account/AccountPhotoQueueScope.tsx");
    const provider = source("components/photos/PhotoUploadQueueProvider.tsx");

    expect(layout).toMatch(/photoUploadQueueEnabled\(/);
    expect(layout).toMatch(/durablePhotoUploadQueue|durableQueueEnabled/);
    expect(account).toMatch(/photoUploadQueueEnabled\(/);
    expect(account).toMatch(/durablePhotoUploadQueue|durableQueueEnabled/);
    expect(appShell).toMatch(/photoUploadQueueProviderKey\(/);
    expect(appShell).toMatch(/durableQueueEnabled=/);
    expect(accountScope).toMatch(/photoUploadQueueProviderKey\(/);
    expect(accountScope).toMatch(/durableQueueEnabled=/);
    expect(provider).toMatch(/createPhotoUploadQueueStore\(/);
    expect(provider).toMatch(/durableQueueEnabled/);
    expect(provider).toMatch(/isBrowserOnline/);
  });
});
