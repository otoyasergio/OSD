/**
 * Guard that refuses to run mutating E2E tests against anything that could
 * be production. Pure logic lives in checkMutationEnvironment so unit tests
 * (tests/unit/environmentGuard.test.ts) can prove every rule in normal CI.
 */

/** Supabase project ref of the PRODUCTION database. Never mutate it. */
const PRODUCTION_SUPABASE_REF = "eofxprepuajpqyvlolhw";

/** Production web host (any subdomain of this is also production). */
const PRODUCTION_HOST_SUFFIX = "torontomoto.com";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

export type MutationEnvironmentCheck = {
  ok: boolean;
  reasons: string[];
};

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isProductionHost(host: string): boolean {
  // Deliberately a literal suffix match (not just subdomains): anything that
  // even looks like the production domain is off limits for mutation.
  return host.endsWith(PRODUCTION_HOST_SUFFIX);
}

function isLocalHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}

function isHostedSupabaseUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (host) return host === "supabase.co" || host.endsWith(".supabase.co");
  // Unparseable value: fall back to a substring check rather than allowing it.
  return url.includes(".supabase.co");
}

/**
 * Evaluates whether `env` is a safe, explicitly opted-in target for tests
 * that mutate data. Returns every violated rule, not just the first.
 */
export function checkMutationEnvironment(
  env: Record<string, string | undefined>
): MutationEnvironmentCheck {
  const reasons: string[] = [];

  if (env.E2E_ALLOW_MUTATION !== "1") {
    reasons.push("E2E_ALLOW_MUTATION must be '1' to run tests that mutate data.");
  }

  const baseUrl = env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL;
  const baseHost = hostnameOf(baseUrl);
  if (!baseHost) {
    reasons.push(`PLAYWRIGHT_BASE_URL is not a valid URL: '${baseUrl}'.`);
  } else if (isProductionHost(baseHost)) {
    reasons.push(
      `PLAYWRIGHT_BASE_URL host '${baseHost}' is the production site ` +
        `(*.${PRODUCTION_HOST_SUFFIX}); mutating tests are never allowed there.`
    );
  } else if (!isLocalHost(baseHost)) {
    const allowedHosts = (env.E2E_ALLOWED_PREVIEW_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (!allowedHosts.includes(baseHost)) {
      reasons.push(
        `PLAYWRIGHT_BASE_URL host '${baseHost}' is not 127.0.0.1/localhost ` +
          "and is not listed in E2E_ALLOWED_PREVIEW_HOSTS."
      );
    }
  }

  const supabaseUrls: Array<[name: string, value: string | undefined]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL],
    ["TEST_SUPABASE_URL", env.TEST_SUPABASE_URL],
  ];

  for (const [name, value] of supabaseUrls) {
    if (value && value.includes(PRODUCTION_SUPABASE_REF)) {
      reasons.push(
        `${name} points at the PRODUCTION Supabase project ` +
          `(${PRODUCTION_SUPABASE_REF}); mutating tests are never allowed there.`
      );
    }
  }

  // Hosted (non-local) Supabase projects need an explicit second opt-in,
  // whether targeted directly (TEST_SUPABASE_URL) or via the app under test
  // (NEXT_PUBLIC_SUPABASE_URL).
  if (env.E2E_ALLOW_REMOTE_SUPABASE !== "1") {
    for (const [name, value] of supabaseUrls) {
      if (value && isHostedSupabaseUrl(value)) {
        reasons.push(
          `${name} is a hosted *.supabase.co project; set ` +
            "E2E_ALLOW_REMOTE_SUPABASE='1' to confirm it is a disposable QA project."
        );
      }
    }
  }

  if (env.SQUARE_ENVIRONMENT !== undefined && env.SQUARE_ENVIRONMENT !== "sandbox") {
    reasons.push(
      `SQUARE_ENVIRONMENT must be 'sandbox' when set (got '${env.SQUARE_ENVIRONMENT}').`
    );
  }

  if (env.TWILIO_AUTH_TOKEN) {
    reasons.push("TWILIO_AUTH_TOKEN must be unset so tests cannot send real SMS.");
  }

  if (env.RESEND_API_KEY) {
    reasons.push("RESEND_API_KEY must be unset so tests cannot send real email.");
  }

  const locationCode = env.E2E_FIXTURE_LOCATION_CODE ?? "QA";
  if (locationCode !== "QA") {
    reasons.push(
      `E2E_FIXTURE_LOCATION_CODE must be 'QA' (got '${locationCode}'); ` +
        "fixtures may only touch the synthetic QA location."
    );
  }

  return { ok: reasons.length === 0, reasons };
}

/** Throws with every violated rule unless `env` is a safe mutation target. */
export function assertSafeMutationEnvironment(
  env: Record<string, string | undefined> = process.env
): void {
  const result = checkMutationEnvironment(env);
  if (!result.ok) {
    throw new Error(
      "Refusing to run mutating E2E tests:\n" +
        result.reasons.map((reason) => `  - ${reason}`).join("\n")
    );
  }
}
