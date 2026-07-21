import { describe, expect, it } from "vitest";
import {
  assertSafeMutationEnvironment,
  checkMutationEnvironment,
} from "@/tests/e2e/fixtures/environmentGuard";

/**
 * CI proof that mutating tests can never point at production: every rule in
 * checkMutationEnvironment is exercised here and runs in plain `npm test`.
 */

const PRODUCTION_REF = "eofxprepuajpqyvlolhw";

function safeEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    E2E_ALLOW_MUTATION: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    ...overrides,
  };
}

function reasonsFor(env: Record<string, string | undefined>): string[] {
  return checkMutationEnvironment(env).reasons;
}

describe("checkMutationEnvironment", () => {
  it("accepts a local stack with mutation explicitly enabled", () => {
    const result = checkMutationEnvironment(safeEnv());
    expect(result).toEqual({ ok: true, reasons: [] });
  });

  it("accepts localhost as well as 127.0.0.1 base URLs", () => {
    for (const base of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect(checkMutationEnvironment(safeEnv({ PLAYWRIGHT_BASE_URL: base })).ok).toBe(
        true
      );
    }
  });

  it("uses http://127.0.0.1:3000 when PLAYWRIGHT_BASE_URL is unset", () => {
    const env = safeEnv();
    delete env.PLAYWRIGHT_BASE_URL;
    expect(checkMutationEnvironment(env).ok).toBe(true);
  });

  describe("E2E_ALLOW_MUTATION", () => {
    it("fails when unset", () => {
      const env = safeEnv({ E2E_ALLOW_MUTATION: undefined });
      expect(reasonsFor(env)).toEqual([expect.stringContaining("E2E_ALLOW_MUTATION")]);
    });

    it("fails for any value other than '1'", () => {
      for (const value of ["0", "true", "yes", ""]) {
        const result = checkMutationEnvironment(safeEnv({ E2E_ALLOW_MUTATION: value }));
        expect(result.ok).toBe(false);
      }
    });
  });

  describe("base URL host rules", () => {
    it("rejects the production site", () => {
      const reasons = reasonsFor(
        safeEnv({ PLAYWRIGHT_BASE_URL: "https://service.torontomoto.com" })
      );
      expect(reasons).toEqual([expect.stringContaining("production site")]);
    });

    it("rejects the bare production apex domain", () => {
      const result = checkMutationEnvironment(
        safeEnv({ PLAYWRIGHT_BASE_URL: "https://torontomoto.com" })
      );
      expect(result.ok).toBe(false);
    });

    it("rejects any torontomoto.com subdomain even when allow-listed", () => {
      const reasons = reasonsFor(
        safeEnv({
          PLAYWRIGHT_BASE_URL: "https://staging.torontomoto.com",
          E2E_ALLOWED_PREVIEW_HOSTS: "staging.torontomoto.com",
        })
      );
      expect(reasons).toEqual([expect.stringContaining("production site")]);
    });

    it("rejects any host with a torontomoto.com suffix, even allow-listed lookalikes", () => {
      const result = checkMutationEnvironment(
        safeEnv({
          PLAYWRIGHT_BASE_URL: "https://nottorontomoto.com",
          E2E_ALLOWED_PREVIEW_HOSTS: "nottorontomoto.com",
        })
      );
      expect(result.ok).toBe(false);
    });

    it("rejects non-local hosts that are not allow-listed", () => {
      const reasons = reasonsFor(
        safeEnv({ PLAYWRIGHT_BASE_URL: "https://preview.vercel.app" })
      );
      expect(reasons).toEqual([expect.stringContaining("E2E_ALLOWED_PREVIEW_HOSTS")]);
    });

    it("accepts hosts listed in E2E_ALLOWED_PREVIEW_HOSTS", () => {
      const result = checkMutationEnvironment(
        safeEnv({
          PLAYWRIGHT_BASE_URL: "https://preview.vercel.app",
          E2E_ALLOWED_PREVIEW_HOSTS: "other.example.com, preview.vercel.app",
        })
      );
      expect(result.ok).toBe(true);
    });

    it("matches allow-listed hosts case-insensitively", () => {
      const result = checkMutationEnvironment(
        safeEnv({
          PLAYWRIGHT_BASE_URL: "https://Preview.Vercel.app",
          E2E_ALLOWED_PREVIEW_HOSTS: "preview.vercel.app",
        })
      );
      expect(result.ok).toBe(true);
    });

    it("fails on an unparseable base URL", () => {
      const reasons = reasonsFor(safeEnv({ PLAYWRIGHT_BASE_URL: "not a url" }));
      expect(reasons).toEqual([expect.stringContaining("not a valid URL")]);
    });
  });

  describe("Supabase URL rules", () => {
    it("rejects NEXT_PUBLIC_SUPABASE_URL containing the production ref", () => {
      const reasons = reasonsFor(
        safeEnv({
          NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
          E2E_ALLOW_REMOTE_SUPABASE: "1",
        })
      );
      expect(reasons).toEqual([expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL")]);
      expect(reasons[0]).toContain("PRODUCTION");
    });

    it("rejects TEST_SUPABASE_URL containing the production ref", () => {
      const result = checkMutationEnvironment(
        safeEnv({
          TEST_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
          E2E_ALLOW_REMOTE_SUPABASE: "1",
        })
      );
      expect(result.ok).toBe(false);
      expect(result.reasons).toEqual([expect.stringContaining("TEST_SUPABASE_URL")]);
    });

    it("rejects the production ref even inside a connection string", () => {
      const result = checkMutationEnvironment(
        safeEnv({
          TEST_SUPABASE_URL: `postgresql://db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
          E2E_ALLOW_REMOTE_SUPABASE: "1",
        })
      );
      expect(result.ok).toBe(false);
    });

    it("requires E2E_ALLOW_REMOTE_SUPABASE for hosted supabase.co projects", () => {
      const reasons = reasonsFor(
        safeEnv({
          NEXT_PUBLIC_SUPABASE_URL: "https://qa-disposable.supabase.co",
        })
      );
      expect(reasons).toEqual([expect.stringContaining("E2E_ALLOW_REMOTE_SUPABASE")]);
    });

    it("gates hosted TEST_SUPABASE_URL projects too", () => {
      const result = checkMutationEnvironment(
        safeEnv({ TEST_SUPABASE_URL: "https://qa-disposable.supabase.co" })
      );
      expect(result.ok).toBe(false);
    });

    it("allows hosted non-production projects when explicitly opted in", () => {
      const result = checkMutationEnvironment(
        safeEnv({
          NEXT_PUBLIC_SUPABASE_URL: "https://qa-disposable.supabase.co",
          E2E_ALLOW_REMOTE_SUPABASE: "1",
        })
      );
      expect(result).toEqual({ ok: true, reasons: [] });
    });

    it("never gates local supabase URLs", () => {
      const result = checkMutationEnvironment(
        safeEnv({ TEST_SUPABASE_URL: "http://127.0.0.1:54321" })
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("third-party side effects", () => {
    it("rejects SQUARE_ENVIRONMENT other than sandbox", () => {
      const reasons = reasonsFor(safeEnv({ SQUARE_ENVIRONMENT: "production" }));
      expect(reasons).toEqual([expect.stringContaining("SQUARE_ENVIRONMENT")]);
    });

    it("accepts SQUARE_ENVIRONMENT=sandbox or unset", () => {
      expect(
        checkMutationEnvironment(safeEnv({ SQUARE_ENVIRONMENT: "sandbox" })).ok
      ).toBe(true);
      expect(checkMutationEnvironment(safeEnv()).ok).toBe(true);
    });

    it("rejects a set TWILIO_AUTH_TOKEN", () => {
      const reasons = reasonsFor(safeEnv({ TWILIO_AUTH_TOKEN: "abc123" }));
      expect(reasons).toEqual([expect.stringContaining("TWILIO_AUTH_TOKEN")]);
    });

    it("rejects a set RESEND_API_KEY", () => {
      const reasons = reasonsFor(safeEnv({ RESEND_API_KEY: "re_123" }));
      expect(reasons).toEqual([expect.stringContaining("RESEND_API_KEY")]);
    });
  });

  describe("fixture location code", () => {
    it("defaults to QA and passes", () => {
      expect(checkMutationEnvironment(safeEnv()).ok).toBe(true);
    });

    it("rejects any code other than QA", () => {
      const reasons = reasonsFor(safeEnv({ E2E_FIXTURE_LOCATION_CODE: "TOR" }));
      expect(reasons).toEqual([expect.stringContaining("E2E_FIXTURE_LOCATION_CODE")]);
    });
  });

  it("aggregates every violated rule instead of stopping at the first", () => {
    const result = checkMutationEnvironment({
      E2E_ALLOW_MUTATION: "0",
      PLAYWRIGHT_BASE_URL: "https://service.torontomoto.com",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
      SQUARE_ENVIRONMENT: "production",
      TWILIO_AUTH_TOKEN: "tok",
      RESEND_API_KEY: "key",
      E2E_FIXTURE_LOCATION_CODE: "XX",
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(7);
  });
});

describe("assertSafeMutationEnvironment", () => {
  it("does not throw for a safe environment", () => {
    expect(() => assertSafeMutationEnvironment(safeEnv())).not.toThrow();
  });

  it("throws with all reasons listed", () => {
    const env = safeEnv({
      E2E_ALLOW_MUTATION: undefined,
      PLAYWRIGHT_BASE_URL: "https://service.torontomoto.com",
    });
    expect(() => assertSafeMutationEnvironment(env)).toThrow(
      /E2E_ALLOW_MUTATION[\s\S]*production site/
    );
  });
});
