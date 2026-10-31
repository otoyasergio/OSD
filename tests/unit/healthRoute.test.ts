import { afterEach, describe, expect, it, vi } from "vitest";

const { createAdminClient, isTwilioVoiceConfigured, isWixInboxSmsConfigured } =
  vi.hoisted(() => ({
    createAdminClient: vi.fn(),
    isTwilioVoiceConfigured: vi.fn(),
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
vi.mock("@/lib/twilio/voiceConfig", () => ({
  isTwilioVoiceConfigured,
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
  it("reports explicit Wix SMS and Twilio Voice readiness independently", async () => {
    isWixInboxSmsConfigured.mockReturnValue(true);
    isTwilioVoiceConfigured.mockReturnValue(false);
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
      twilioVoice: "missing",
    });
    expect(body.integrations).not.toHaveProperty("twilioSms");
  });

  it("does not make a live provider request to report readiness", async () => {
    isWixInboxSmsConfigured.mockReturnValue(false);
    isTwilioVoiceConfigured.mockReturnValue(true);
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
