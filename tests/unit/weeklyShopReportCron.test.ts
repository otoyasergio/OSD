import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/weeklyShopReport", () => ({
  sendWeeklyShopReport: vi.fn(),
}));

import { handleWeeklyShopReportCron } from "@/app/api/cron/weekly-shop-report/route";
import { sendWeeklyShopReport } from "@/lib/services/weeklyShopReport";

const send = vi.mocked(sendWeeklyShopReport);
const FRIDAY_8PM = new Date("2026-10-31T00:00:00.000Z");
const FRIDAY_7PM = new Date("2026-10-30T23:00:00.000Z");

function request(authorization?: string) {
  return new Request("https://service.torontomoto.com/api/cron/weekly-shop-report", {
    headers: authorization ? { authorization } : {},
  });
}

describe("weekly shop report cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await handleWeeklyShopReportCron(
      request("Bearer cron-secret"),
      FRIDAY_8PM
    );
    expect(response.status).toBe(500);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a bad secret", async () => {
    const response = await handleWeeklyShopReportCron(
      request("Bearer wrong"),
      FRIDAY_8PM
    );
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips outside Friday 8:00 p.m. Toronto", async () => {
    const response = await handleWeeklyShopReportCron(
      request("Bearer cron-secret"),
      FRIDAY_7PM
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: "outside_window",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send twice for the same Monday key", async () => {
    send
      .mockResolvedValueOnce({ ok: true, messageId: "gmail-1" })
      .mockResolvedValueOnce({ ok: true, skipped: "already_sent" });

    const first = await handleWeeklyShopReportCron(
      request("Bearer cron-secret"),
      FRIDAY_8PM
    );
    const second = await handleWeeklyShopReportCron(
      request("Bearer cron-secret"),
      FRIDAY_8PM
    );

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ ok: true, messageId: "gmail-1" });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({
      ok: true,
      skipped: "already_sent",
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, FRIDAY_8PM);
    expect(send).toHaveBeenNthCalledWith(2, FRIDAY_8PM);
  });
});
