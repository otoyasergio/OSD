import { afterEach, describe, expect, it, vi } from "vitest";

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
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
vi.mock("@/lib/twilio/voiceConfig", () => ({
  isTwilioVoiceConfigured: () => true,
}));
vi.mock("@/lib/wix/config", () => ({
  isWixContactsConfigured: () => true,
  isWixInboxSmsConfigured: () => true,
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
  it("reports Wix SMS readiness without an obsolete Twilio SMS status", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACobsolete");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "obsolete-token");
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
      twilioVoice: "ok",
    });
    expect(body.integrations).not.toHaveProperty("twilioSms");
  });
});
