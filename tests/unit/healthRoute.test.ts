import { afterEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, isWixInboxSmsConfigured } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  isWixInboxSmsConfigured: vi.fn(),
}));

vi.mock("@/lib/database/supabase-admin", () => ({ createAdminClient }));
vi.mock("@/lib/partsCanada/config", () => ({
  isPartsCanadaConfigured: () => true,
}));
vi.mock("@/lib/square/config", () => ({
  isSquareConfigured: () => true,
}));
vi.mock("@/lib/email/config", () => ({
  isGmailOAuthConfigured: () => false,
}));
vi.mock("@/lib/wix/config", () => ({
  isWixContactsConfigured: () => true,
  isWixInboxSmsConfigured,
}));
vi.mock("@/lib/diagnostics/health", () => ({
  askOtomotoHealthStatus: () => "ok",
}));
vi.mock("@/lib/services/healthStatus", () => ({
  summarizeIntegrationHealth: () => ({ ok: true, degraded: false }),
}));

import { GET } from "@/app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("health route messaging status", () => {
  it("reports Voice missing when token credentials exist but webhook auth does not", async () => {
    isWixInboxSmsConfigured.mockReturnValue(true);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACvoice");
    vi.stubEnv("TWILIO_API_KEY_SID", "SKvoice");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "api-secret");
    vi.stubEnv("TWILIO_TWIML_APP_SID", "APvoice");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+16474241088");
    createAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          limit: async () => ({ error: null }),
        }),
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.integrations).toMatchObject({
      wix: "ok",
      wixSms: "ok",
      twilioVoice: "missing",
    });
    expect(body.integrations).not.toHaveProperty("twilioSms");
  });

  it("reports full Voice credentials ok without a live provider request", async () => {
    isWixInboxSmsConfigured.mockReturnValue(false);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACvoice");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "webhook-auth-token");
    vi.stubEnv("TWILIO_API_KEY_SID", "SKvoice");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "api-secret");
    vi.stubEnv("TWILIO_TWIML_APP_SID", "APvoice");
    const providerFetch = vi.spyOn(globalThis, "fetch");
    createAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          limit: async () => ({ error: null }),
        }),
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(body.integrations).toMatchObject({
      wixSms: "missing",
      twilioVoice: "ok",
    });
    expect(providerFetch).not.toHaveBeenCalled();
    providerFetch.mockRestore();
  });
});
