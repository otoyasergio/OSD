import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  filterPassportSentryEvent,
  redactPassportTokens,
} from "@/lib/passport/sentryPrivacy";

describe("passport Sentry privacy", () => {
  it("redacts passport bearer tokens anywhere in a retained event", () => {
    expect(
      redactPassportTokens(
        "visited https://service.torontomoto.com/p/secret-token?print=1"
      )
    ).toBe("visited https://service.torontomoto.com/p/[redacted]?print=1");

    expect(
      filterPassportSentryEvent({
        request: { url: "https://service.torontomoto.com/dashboard" },
        breadcrumbs: [
          {
            data: {
              from: "/p/secret-token",
              to: "/dashboard",
            },
          },
        ],
      })
    ).toEqual({
      request: { url: "https://service.torontomoto.com/dashboard" },
      breadcrumbs: [
        {
          data: {
            from: "/p/[redacted]",
            to: "/dashboard",
          },
        },
      ],
    });
  });

  it("drops events and transactions whose active request is a passport link", () => {
    expect(
      filterPassportSentryEvent({
        request: {
          url: "https://service.torontomoto.com/p/secret-token",
        },
      })
    ).toBeNull();
    expect(
      filterPassportSentryEvent(
        { transaction: "/p/[token]" },
        "https://service.torontomoto.com/p/actual-secret"
      )
    ).toBeNull();
  });

  it("leaves unrelated events unchanged", () => {
    const event = { request: { url: "/work_orders/123" }, message: "failed" };
    expect(filterPassportSentryEvent(event)).toEqual(event);
  });

  it("wires filtering into client, server, and edge Sentry delivery", () => {
    for (const filename of [
      "sentry.client.config.ts",
      "sentry.server.config.ts",
      "sentry.edge.config.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), filename), "utf8");
      expect(source).toContain("filterPassportSentryEvent");
      expect(source).toContain("beforeSend:");
      expect(source).toContain("beforeSendTransaction:");
    }
  });
});
