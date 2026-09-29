import {
  E2E_ENV_GUARD_HEADER,
  fingerprintSupabaseTarget,
} from "../../../lib/e2e/environmentFingerprintCore";

type FingerprintResponse = {
  supabaseTargetFingerprint: string;
  openAIConfigured: boolean;
  twilioConfigured: boolean;
  resendConfigured: boolean;
};

function isFingerprintResponse(value: unknown): value is FingerprintResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.supabaseTargetFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(record.supabaseTargetFingerprint) &&
    typeof record.openAIConfigured === "boolean" &&
    typeof record.twilioConfigured === "boolean" &&
    typeof record.resendConfigured === "boolean"
  );
}

export async function assertAppEnvironmentFingerprint(
  input: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
  } = {}
): Promise<void> {
  const env = input.env ?? process.env;
  const fetchRequest = input.fetch ?? fetch;
  const baseUrl = (env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000").replace(
    /\/+$/,
    ""
  );
  const guardSecret = env.E2E_ENV_GUARD_SECRET?.trim();
  const testSupabaseUrl = env.TEST_SUPABASE_URL?.trim();
  if (!guardSecret || !testSupabaseUrl) {
    throw new Error(
      "[e2e] Environment fingerprint preflight requires nonempty " +
        "E2E_ENV_GUARD_SECRET and TEST_SUPABASE_URL on the runner."
    );
  }

  const response = await fetchRequest(`${baseUrl}/api/e2e/environment-fingerprint`, {
    cache: "no-store",
    headers: { [E2E_ENV_GUARD_HEADER]: guardSecret },
  });
  if (!response.ok) {
    throw new Error(
      `[e2e] Environment fingerprint preflight failed with HTTP ${response.status}. ` +
        "Enable the E2E-only guard with the same E2E_ENV_GUARD_SECRET on runner " +
        "and server; do not seed or run stateful specs."
    );
  }

  const payload: unknown = await response.json();
  if (!isFingerprintResponse(payload)) {
    throw new Error(
      "[e2e] Environment fingerprint preflight returned an invalid safe payload; " +
        "do not seed or run stateful specs."
    );
  }

  const expectedFingerprint = fingerprintSupabaseTarget(testSupabaseUrl);
  if (payload.supabaseTargetFingerprint !== expectedFingerprint) {
    throw new Error(
      "[e2e] The app build targets a different Supabase project. Rebuild the app " +
        "using the isolated TEST_SUPABASE URL/public key values before start and " +
        "stateful E2E; no fixture mutations were attempted."
    );
  }

  const configuredProviders = [
    payload.openAIConfigured ? "OpenAI" : null,
    payload.twilioConfigured ? "Twilio" : null,
    payload.resendConfigured ? "Resend" : null,
  ].filter((name): name is string => name !== null);
  if (configuredProviders.length > 0) {
    throw new Error(
      `[e2e] Environment fingerprint preflight found outbound providers configured: ` +
        `${configuredProviders.join(", ")}. Disable AI/SMS/email credentials before ` +
        "stateful E2E; no fixture mutations were attempted."
    );
  }
}
