import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/auctionPriceRefresh", () => ({
  refreshAuctionGuidesDaily: vi.fn(),
}));

import { GET, POST } from "@/app/api/cron/auction-price-refresh/route";
import { refreshAuctionGuidesDaily } from "@/lib/services/auctionPriceRefresh";

const refresh = vi.mocked(refreshAuctionGuidesDaily);

function request(authorization?: string) {
  return new Request("https://service.torontomoto.com/api/cron/auction-price-refresh", {
    headers: authorization ? { authorization } : {},
  });
}

const finished = {
  ok: true as const,
  motorcycles: 2,
  groups: 1,
  providerFetches: 1,
  providerFailures: 0,
  lotsUpserted: 4,
  snapshotsRebuilt: 2,
  skipped: 0,
  failed: 0,
  remaining: 0,
  truncated: false,
};

describe("auction price refresh cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rejects a bad secret", async () => {
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes every motorcycle once a day", async () => {
    refresh.mockResolvedValueOnce(finished);
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(finished);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("accepts the same bearer on POST", async () => {
    refresh.mockResolvedValueOnce(finished);
    const response = await POST(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the refresh cannot run", async () => {
    refresh.mockRejectedValueOnce(new Error("AUCTION_TABLES_MISSING"));
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "AUCTION_PRICE_REFRESH_FAILED",
    });
  });
});
