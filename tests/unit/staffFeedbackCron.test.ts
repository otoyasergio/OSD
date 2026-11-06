import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/staffFeedback", () => ({
  repairStaffFeedback: vi.fn(),
  squashStaffFeedback: vi.fn(),
}));

import { GET } from "@/app/api/cron/staff-feedback-squash/route";
import { repairStaffFeedback, squashStaffFeedback } from "@/lib/services/staffFeedback";

const repair = vi.mocked(repairStaffFeedback);
const squash = vi.mocked(squashStaffFeedback);
const NO_REPAIR = {
  archivesRebuilt: 0,
  archivesFailed: 0,
  loosePicturesRemoved: 0,
  orphanPicturesRemoved: 0,
};
const ELEVEN_PM_WINTER = new Date("2026-11-06T04:00:00.000Z");
const TEN_PM_WINTER = new Date("2026-11-06T03:00:00.000Z");

function request(authorization?: string) {
  return new Request("https://service.torontomoto.com/api/cron/staff-feedback-squash", {
    headers: authorization ? { authorization } : {},
  });
}

describe("staff feedback squash cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.useFakeTimers();
    vi.setSystemTime(ELEVEN_PM_WINTER);
    repair.mockResolvedValue(NO_REPAIR);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects a missing secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    expect(squash).not.toHaveBeenCalled();
  });

  it("rejects a bad secret", async () => {
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(squash).not.toHaveBeenCalled();
  });

  it("repairs outside 11:00 p.m. Toronto and does not pack", async () => {
    vi.setSystemTime(TEN_PM_WINTER);
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: "outside_window",
      repair: NO_REPAIR,
    });
    expect(repair).toHaveBeenCalledWith(TEN_PM_WINTER);
    expect(squash).not.toHaveBeenCalled();
  });

  it("asks for another run when a missing archive could not be rebuilt", async () => {
    vi.setSystemTime(TEN_PM_WINTER);
    repair.mockResolvedValueOnce({ ...NO_REPAIR, archivesFailed: 1 });
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      skipped: "outside_window",
      repair: { archivesFailed: 1 },
    });
    expect(squash).not.toHaveBeenCalled();
  });

  it("packs the day's notes at 11:00 p.m. Toronto", async () => {
    squash.mockResolvedValueOnce({
      ok: true,
      shopDate: "2026-11-05",
      reportCount: 2,
      archivePath: "digests/2026-11-05.zip",
      archiveBytes: 1200,
      repair: NO_REPAIR,
    });

    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      shopDate: "2026-11-05",
      reportCount: 2,
      archivePath: "digests/2026-11-05.zip",
      archiveBytes: 1200,
      repair: NO_REPAIR,
    });
    expect(squash).toHaveBeenCalledTimes(1);
    expect(squash).toHaveBeenCalledWith(ELEVEN_PM_WINTER);
    expect(repair).not.toHaveBeenCalled();
  });

  it("asks for another run when the pack hour could not rebuild an older night", async () => {
    squash.mockResolvedValueOnce({
      ok: true,
      skipped: "already_squashed",
      repair: { ...NO_REPAIR, archivesFailed: 1 },
    });
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    expect(repair).not.toHaveBeenCalled();
  });

  it("returns 500 when the squash is not configured", async () => {
    squash.mockRejectedValueOnce(new Error("STAFF_FEEDBACK_MISCONFIGURED"));
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "STAFF_FEEDBACK_MISCONFIGURED",
    });
  });
});
