import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/storageNotice", () => ({
  sendStorageMonthNotices: vi.fn(),
}));

import { GET } from "@/app/api/cron/storage-notice/route";
import { sendStorageMonthNotices } from "@/lib/services/storageNotice";

const send = vi.mocked(sendStorageMonthNotices);
const MONDAY_10AM_TORONTO = new Date("2026-11-02T15:00:00.000Z");
const MONDAY_9AM_TORONTO = new Date("2026-11-02T14:00:00.000Z");
const SUNDAY_10AM_TORONTO = new Date("2026-11-01T15:00:00.000Z");

function request(authorization?: string) {
  return new Request("https://service.torontomoto.com/api/cron/storage-notice", {
    headers: authorization ? { authorization } : {},
  });
}

describe("storage notice cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_10AM_TORONTO);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects a missing secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a bad secret", async () => {
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips Sunday and hours outside 10:00 or 11:00 Toronto", async () => {
    vi.setSystemTime(SUNDAY_10AM_TORONTO);
    const sunday = await GET(request("Bearer cron-secret"));
    expect(sunday.status).toBe(200);
    await expect(sunday.json()).resolves.toEqual({ ok: true, skipped: "outside_window" });

    vi.setSystemTime(MONDAY_9AM_TORONTO);
    const early = await GET(request("Bearer cron-secret"));
    expect(early.status).toBe(200);
    await expect(early.json()).resolves.toEqual({ ok: true, skipped: "outside_window" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends during the morning window", async () => {
    send.mockResolvedValueOnce({ ok: true, considered: 1, sms: 1, email: 1 });
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      considered: 1,
      sms: 1,
      email: 1,
    });
    expect(send).toHaveBeenCalledWith(MONDAY_10AM_TORONTO);
  });
});
