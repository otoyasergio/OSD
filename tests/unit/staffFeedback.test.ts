import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { isStaffFeedbackSquashHour } from "@/lib/datetime/format";
import { compressStaffFeedbackScreenshot } from "@/lib/staffFeedback/compressScreenshot";
import {
  assertStaffFeedbackRate,
  normalizeStaffFeedbackNote,
  normalizeStaffFeedbackPath,
  normalizeStaffFeedbackViewport,
} from "@/lib/staffFeedback/fields";
import {
  planStaffFeedbackSquash,
  squishStaffFeedbackReports,
  staffFeedbackArchivePath,
} from "@/lib/staffFeedback/squish";

const ALEX = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";

describe("staff feedback notes", () => {
  it("keeps a trimmed complaint and its line breaks", () => {
    expect(normalizeStaffFeedbackNote("  The total is doubled.\nCheck labor.  ")).toBe(
      "The total is doubled.\nCheck labor."
    );
  });

  it("rejects a blank note", () => {
    expect(() => normalizeStaffFeedbackNote("   \n  ")).toThrow(
      "STAFF_FEEDBACK_NOTE_REQUIRED"
    );
  });

  it("rejects a note over 2000 characters", () => {
    expect(() => normalizeStaffFeedbackNote("a".repeat(2001))).toThrow(
      "STAFF_FEEDBACK_NOTE_TOO_LONG"
    );
  });

  it("drops control characters other than line breaks", () => {
    expect(normalizeStaffFeedbackNote("line one\nline\u0000 two")).toBe(
      "line one\nline two"
    );
  });

  it("stores the page path and drops the query string", () => {
    expect(normalizeStaffFeedbackPath("/work_orders/abc?customer=secret#photo")).toBe(
      "/work_orders/abc"
    );
  });

  it("rejects a path that is not on this app", () => {
    expect(() => normalizeStaffFeedbackPath("https://evil.example/work_orders")).toThrow(
      "STAFF_FEEDBACK_PAGE_INVALID"
    );
    expect(() => normalizeStaffFeedbackPath("/../etc/passwd")).toThrow(
      "STAFF_FEEDBACK_PAGE_INVALID"
    );
  });

  it("ignores a viewport size that cannot be a screen", () => {
    expect(normalizeStaffFeedbackViewport("1280")).toBe(1280);
    expect(normalizeStaffFeedbackViewport("0")).toBeNull();
    expect(normalizeStaffFeedbackViewport("nope")).toBeNull();
    expect(normalizeStaffFeedbackViewport(20000)).toBeNull();
  });

  it("stops a person who already sent 8 notes this hour", () => {
    expect(() => assertStaffFeedbackRate(7)).not.toThrow();
    expect(() => assertStaffFeedbackRate(8)).toThrow("STAFF_FEEDBACK_RATE_LIMITED");
  });
});

describe("staff feedback squash hour", () => {
  it("runs at 11:00 p.m. Toronto in winter and summer", () => {
    expect(isStaffFeedbackSquashHour(new Date("2026-11-06T04:00:00.000Z"))).toBe(true);
    expect(isStaffFeedbackSquashHour(new Date("2026-07-16T03:00:00.000Z"))).toBe(true);
  });

  it("skips the other UTC tick that only exists for daylight saving", () => {
    expect(isStaffFeedbackSquashHour(new Date("2026-11-06T03:00:00.000Z"))).toBe(false);
    expect(isStaffFeedbackSquashHour(new Date("2026-07-16T04:00:00.000Z"))).toBe(false);
  });
});

describe("staff feedback archive", () => {
  it("names the daily zip from the shop date", () => {
    expect(staffFeedbackArchivePath("2026-11-05")).toBe("digests/2026-11-05.zip");
  });

  it("refuses a date that could change the storage path", () => {
    expect(() => staffFeedbackArchivePath("2026-11-05/../../other")).toThrow(
      "STAFF_FEEDBACK_DATE_INVALID"
    );
  });

  it("skips when today's archive already exists, even if new notes arrived", () => {
    expect(planStaffFeedbackSquash({ digestExists: true, reportCount: 3 })).toEqual({
      action: "already_squashed",
    });
  });

  it("does nothing when there are no open notes", () => {
    expect(planStaffFeedbackSquash({ digestExists: false, reportCount: 0 })).toEqual({
      action: "nothing_to_squash",
    });
  });

  it("packs open notes when the day has not been squashed", () => {
    expect(planStaffFeedbackSquash({ digestExists: false, reportCount: 2 })).toEqual({
      action: "squash",
    });
  });

  it("packs notes and pictures into one zip", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const result = squishStaffFeedbackReports(
      [
        {
          reportId: SAM,
          createdAt: "2026-11-05T21:00:00.000Z",
          actorName: "Sam Lee",
          role: "service_advisor",
          pagePath: "/billing",
          note: "Tax shows twice.",
          screenshot: null,
        },
        {
          reportId: ALEX,
          createdAt: "2026-11-05T16:00:00.000Z",
          actorName: "Alex Chen",
          role: "technician",
          pagePath: "/technician",
          note: "The dock covers the save button.",
          screenshot: jpeg,
        },
      ],
      "2026-11-05"
    );

    expect(result.reportCount).toBe(2);
    expect(result.archivePath).toBe("digests/2026-11-05.zip");
    expect(result.summary).toContain("Alex Chen");
    expect(result.summary).toContain("The dock covers the save button.");
    expect(result.summary).toContain("Tax shows twice.");
    expect(result.summary.indexOf("Alex Chen")).toBeLessThan(
      result.summary.indexOf("Sam Lee")
    );

    const unzipped = unzipSync(result.bytes);
    expect(strFromU8(unzipped["manifest.txt"] ?? new Uint8Array())).toBe(result.summary);
    expect(unzipped[`reports/${ALEX}.jpg`]).toEqual(jpeg);
    expect(unzipped[`reports/${SAM}.jpg`]).toBeUndefined();
  });
});

describe("staff feedback screenshot compression", () => {
  it("turns a wide screenshot into a jpeg no wider than 1440 pixels", async () => {
    const source = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: "#f4f4f5",
      },
    })
      .png()
      .toBuffer();

    const result = await compressStaffFeedbackScreenshot(source);
    expect(result.contentType).toBe("image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(1440);
    expect(meta.height).toBeLessThanOrEqual(1440);
    expect(result.bytes.byteLength).toBeLessThanOrEqual(500_000);
    expect(result.bytes.byteLength).toBeLessThan(source.byteLength);
  });

  it("rejects a file that is not a picture", async () => {
    await expect(
      compressStaffFeedbackScreenshot(Uint8Array.from([1, 2, 3, 4]))
    ).rejects.toThrow("STAFF_FEEDBACK_SCREENSHOT_INVALID");
  });
});
