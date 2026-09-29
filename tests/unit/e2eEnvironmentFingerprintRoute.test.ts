import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/e2e/environment-fingerprint/route";
import { fingerprintSupabaseTarget } from "@/lib/e2e/environmentFingerprintCore";

const URL = "https://qa-project.supabase.co";
const SECRET = "synthetic-e2e-guard-secret";
const HEADER = "x-e2e-env-guard-secret";

function request(secret?: string): Request {
  return new Request("http://localhost/api/e2e/environment-fingerprint", {
    headers: secret ? { [HEADER]: secret } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("E2E environment fingerprint route", () => {
  it("is undiscoverable when mutation mode or the server secret is absent", async () => {
    vi.stubEnv("E2E_ALLOW_MUTATION", "0");
    vi.stubEnv("E2E_ENV_GUARD_SECRET", SECRET);
    expect((await GET(request(SECRET))).status).toBe(404);

    vi.stubEnv("E2E_ALLOW_MUTATION", "1");
    vi.stubEnv("E2E_ENV_GUARD_SECRET", "");
    expect((await GET(request(SECRET))).status).toBe(404);
  });

  it("rejects a missing or incorrect guard header", async () => {
    vi.stubEnv("E2E_ALLOW_MUTATION", "1");
    vi.stubEnv("E2E_ENV_GUARD_SECRET", SECRET);

    expect((await GET(request())).status).toBe(403);
    expect((await GET(request("wrong-secret"))).status).toBe(403);
  });

  it("returns only a target fingerprint and outbound-provider booleans", async () => {
    vi.stubEnv("E2E_ALLOW_MUTATION", "1");
    vi.stubEnv("E2E_ENV_GUARD_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL);
    vi.stubEnv("OPENAI_API_KEY", "synthetic-openai-secret");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "synthetic-twilio-secret");
    vi.stubEnv("RESEND_API_KEY", "synthetic-resend-secret");

    const response = await GET(request(SECRET));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      supabaseTargetFingerprint: fingerprintSupabaseTarget(URL),
      openAIConfigured: true,
      twilioConfigured: true,
      resendConfigured: true,
    });
    expect(JSON.stringify(body)).not.toMatch(
      /qa-project|supabase\.co|synthetic-|guard-secret|auth|header|key/i
    );
  });
});
