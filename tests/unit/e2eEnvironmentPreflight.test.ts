import { describe, expect, it, vi } from "vitest";
import { fingerprintSupabaseTarget } from "@/lib/e2e/environmentFingerprintCore";
import { assertAppEnvironmentFingerprint } from "@/tests/e2e/fixtures/appEnvironmentPreflight";

const TEST_URL = "https://isolated-qa.supabase.co";
const SECRET = "synthetic-runner-server-secret";

function env(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    E2E_ALLOW_MUTATION: "1",
    E2E_ENV_GUARD_SECRET: SECRET,
    PLAYWRIGHT_BASE_URL: "https://qa-app.example.invalid",
    TEST_SUPABASE_URL: TEST_URL,
    ...overrides,
  };
}

function response(
  overrides: Partial<{
    supabaseTargetFingerprint: string;
    openAIConfigured: boolean;
    twilioConfigured: boolean;
    resendConfigured: boolean;
  }> = {}
): Response {
  return Response.json({
    supabaseTargetFingerprint: fingerprintSupabaseTarget(TEST_URL),
    openAIConfigured: false,
    twilioConfigured: false,
    resendConfigured: false,
    ...overrides,
  });
}

describe("stateful E2E app environment preflight", () => {
  it("sends the server guard secret and accepts the isolated target", async () => {
    const fetch = vi.fn().mockResolvedValue(response());

    await expect(
      assertAppEnvironmentFingerprint({ env: env(), fetch })
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://qa-app.example.invalid/api/e2e/environment-fingerprint",
      expect.objectContaining({
        cache: "no-store",
        headers: { "x-e2e-env-guard-secret": SECRET },
      })
    );
  });

  it("fails with rebuild instructions when the app target differs", async () => {
    await expect(
      assertAppEnvironmentFingerprint({
        env: env(),
        fetch: vi
          .fn()
          .mockResolvedValue(response({ supabaseTargetFingerprint: "f".repeat(64) })),
      })
    ).rejects.toThrow(/rebuild.*isolated TEST_SUPABASE/i);
  });

  it.each([
    ["OpenAI", { openAIConfigured: true }],
    ["Twilio", { twilioConfigured: true }],
    ["Resend", { resendConfigured: true }],
  ] as const)("fails when %s is configured on the app", async (provider, flags) => {
    await expect(
      assertAppEnvironmentFingerprint({
        env: env(),
        fetch: vi.fn().mockResolvedValue(response(flags)),
      })
    ).rejects.toThrow(new RegExp(provider, "i"));
  });

  it("fails closed when the guarded route is unavailable or forbidden", async () => {
    for (const status of [403, 404]) {
      await expect(
        assertAppEnvironmentFingerprint({
          env: env(),
          fetch: vi.fn().mockResolvedValue(new Response(null, { status })),
        })
      ).rejects.toThrow(/fingerprint preflight/i);
    }
  });
});
