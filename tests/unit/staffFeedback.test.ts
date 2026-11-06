import { unzipSync, strFromU8 } from "fflate";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { isStaffFeedbackSquashHour } from "@/lib/datetime/format";
import { compressStaffFeedbackScreenshot } from "@/lib/staffFeedback/compressScreenshot";
import {
  isStaffFeedbackManagedPath,
  isZipArchive,
  repairStaffFeedbackStorage,
  selectUnreferencedStaffFeedbackObjects,
  staffFeedbackSummaryArchive,
} from "@/lib/staffFeedback/repair";
import {
  assertStaffFeedbackRate,
  normalizeStaffFeedbackNote,
  normalizeStaffFeedbackPath,
  normalizeStaffFeedbackViewport,
} from "@/lib/staffFeedback/fields";
import {
  buildStaffFeedbackArchive,
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

  it("keeps the earlier notes when the zip has to shrink", () => {
    const earlier = {
      reportId: ALEX,
      createdAt: "2026-11-05T16:00:00.000Z",
      actorName: "Alex Chen",
      role: "technician",
      pagePath: "/technician",
      note: "The dock covers the save button.",
      screenshot: null,
    };
    const later = {
      reportId: SAM,
      createdAt: "2026-11-05T21:00:00.000Z",
      actorName: "Sam Lee",
      role: "service_advisor",
      pagePath: "/billing",
      note: "Tax shows twice on the same invoice line.",
      screenshot: null,
    };
    const one = squishStaffFeedbackReports([earlier], "2026-11-05");
    const packed = buildStaffFeedbackArchive(
      [earlier, later],
      "2026-11-05",
      one.bytes.byteLength
    );
    expect(packed.reportIds).toEqual([ALEX]);
    expect(packed.bytes.byteLength).toBeLessThanOrEqual(one.bytes.byteLength);
  });

  it("refuses a single note that cannot fit in one archive", () => {
    expect(() =>
      buildStaffFeedbackArchive(
        [
          {
            reportId: ALEX,
            createdAt: "2026-11-05T16:00:00.000Z",
            actorName: "Alex Chen",
            role: "technician",
            pagePath: "/technician",
            note: "The dock covers the save button.",
            screenshot: null,
          },
        ],
        "2026-11-05",
        1
      )
    ).toThrow("STAFF_FEEDBACK_SQUASH_FAILED");
  });

  it("refuses a duplicated report id and a blank note", () => {
    const report = {
      reportId: ALEX,
      createdAt: "2026-11-05T16:00:00.000Z",
      actorName: "Alex Chen",
      role: "technician",
      pagePath: "/technician",
      note: "The dock covers the save button.",
      screenshot: null,
    };
    expect(() => squishStaffFeedbackReports([report, report], "2026-11-05")).toThrow(
      "STAFF_FEEDBACK_REPORT_INVALID"
    );
    expect(() =>
      squishStaffFeedbackReports([{ ...report, note: " \n\u0000 " }], "2026-11-05")
    ).toThrow("STAFF_FEEDBACK_NOTE_REQUIRED");
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

describe("staff feedback repair", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const oldPicture = {
    path: `${SAM}/${SAM}.jpg`,
    createdAt: "2026-11-05T12:00:00.000Z",
  };

  it("recognizes a zip and ignores a plain picture", () => {
    expect(isZipArchive(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZipArchive(jpeg)).toBe(false);
  });

  it("keeps a fresh upload, a saved picture, and a file this bucket does not own", () => {
    const now = new Date("2026-11-06T05:00:00.000Z");
    expect(
      selectUnreferencedStaffFeedbackObjects({
        now,
        referencedPaths: new Set([oldPicture.path]),
        objects: [
          oldPicture,
          { path: `${ALEX}/${ALEX}.jpg`, createdAt: "2026-11-06T04:30:00.000Z" },
          { path: "notes/not-a-picture.txt", createdAt: "2026-11-01T00:00:00.000Z" },
          { path: `${SAM}/${ALEX}.jpg`, createdAt: "" },
        ],
      })
    ).toEqual([]);
  });

  it("leaves a referenced file alone when only the letter case differs", () => {
    const now = new Date("2026-11-06T05:00:00.000Z");
    expect(
      selectUnreferencedStaffFeedbackObjects({
        now,
        referencedPaths: new Set(["  DIGESTS/2026-11-04.ZIP  "]),
        objects: [
          { path: "digests/2026-11-04.zip", createdAt: "2026-11-04T04:00:00.000Z" },
          { path: oldPicture.path, createdAt: "2026-11-06T03:00:00.000Z" },
          { path: ` ${oldPicture.path} `, createdAt: "2026-11-01T00:00:00.000Z" },
          { path: `${ALEX}/${ALEX}.jpg`, createdAt: "2026-11-06T03:00:00.001Z" },
          { path: "digests/not-a-date.zip", createdAt: "2026-11-01T00:00:00.000Z" },
          { path: "../digests/2026-11-01.zip", createdAt: "2026-11-01T00:00:00.000Z" },
        ],
      })
    ).toEqual([oldPicture.path]);
    expect(isStaffFeedbackManagedPath(`Digests/2026-11-04.ZIP`)).toBe(true);
    expect(isStaffFeedbackManagedPath("notes/not-ours.txt")).toBe(false);
  });

  it("selects a leftover picture and a zip that no longer has a night", () => {
    expect(
      selectUnreferencedStaffFeedbackObjects({
        now: new Date("2026-11-06T05:00:00.000Z"),
        referencedPaths: new Set(),
        objects: [
          oldPicture,
          { path: "digests/2026-11-04.zip", createdAt: "2026-11-04T04:00:00.000Z" },
        ],
      })
    ).toEqual([oldPicture.path, "digests/2026-11-04.zip"]);
  });

  it("rebuilds a missing night from the notes, then deletes a leftover picture", async () => {
    const put: string[] = [];
    const recorded: number[] = [];
    const removed: string[] = [];
    const counts = await repairStaffFeedbackStorage({
      now: new Date("2026-11-06T05:00:00.000Z"),
      digests: [
        {
          digestId: "digest-1",
          shopDate: "2026-11-05",
          archivePath: "digests/2026-11-05.zip",
          summary: "old summary",
        },
      ],
      archiveExists: async () => false,
      reportsForDigest: async () => [
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
      putArchive: async (path, bytes) => {
        put.push(path);
        expect(isZipArchive(bytes)).toBe(true);
        const unzipped = unzipSync(bytes);
        expect(unzipped[`reports/${ALEX}.jpg`]).toEqual(jpeg);
      },
      recordArchive: async (_digestId, archiveBytes) => {
        recorded.push(archiveBytes);
      },
      clearLoosePictures: async () => 2,
      listObjects: async () => [oldPicture],
      referencedPaths: async () => [],
      removeObjects: async (paths) => {
        removed.push(...paths);
      },
    });

    expect(put).toEqual(["digests/2026-11-05.zip"]);
    expect(recorded).toHaveLength(1);
    expect(removed).toEqual([oldPicture.path]);
    expect(counts).toEqual({
      archivesRebuilt: 1,
      archivesFailed: 0,
      loosePicturesRemoved: 2,
      orphanPicturesRemoved: 1,
    });
  });

  it("writes the saved summary when the note rows are already gone", async () => {
    let manifest = "";
    await repairStaffFeedbackStorage({
      now: new Date("2026-11-06T05:00:00.000Z"),
      digests: [
        {
          digestId: "digest-1",
          shopDate: "2026-11-05",
          archivePath: "digests/2026-11-05.zip",
          summary: "Alex Chen, Technician\nThe dock covers the save button.",
        },
      ],
      archiveExists: async () => false,
      reportsForDigest: async () => [],
      putArchive: async (_path, bytes) => {
        manifest = strFromU8(unzipSync(bytes)["manifest.txt"] ?? new Uint8Array());
      },
      recordArchive: async () => {},
      clearLoosePictures: async () => 0,
      listObjects: async () => [],
      referencedPaths: async () => [],
      removeObjects: async () => {},
    });
    expect(manifest).toContain("The dock covers the save button.");
  });

  it("leaves a stored night alone and still reports a rebuild that failed", async () => {
    const put = vi.fn();
    const counts = await repairStaffFeedbackStorage({
      now: new Date("2026-11-06T05:00:00.000Z"),
      digests: [
        {
          digestId: "kept",
          shopDate: "2026-11-05",
          archivePath: "digests/2026-11-05.zip",
          summary: "kept",
        },
        {
          digestId: "broken",
          shopDate: "2026-11-04",
          archivePath: "digests/2026-11-04.zip",
          summary: "broken",
        },
      ],
      archiveExists: async (path) => path.endsWith("2026-11-05.zip"),
      reportsForDigest: async () => [],
      putArchive: async () => {
        put();
        throw new Error("storage down");
      },
      recordArchive: async () => {},
      clearLoosePictures: async () => 0,
      listObjects: async () => [],
      referencedPaths: async () => [],
      removeObjects: async () => {},
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(counts.archivesRebuilt).toBe(0);
    expect(counts.archivesFailed).toBe(1);
  });

  it("does not rewrite a night whose path is wrong, blank, or too long", async () => {
    const put = vi.fn();
    const counts = await repairStaffFeedbackStorage({
      now: new Date("2026-11-06T05:00:00.000Z"),
      digests: [
        {
          digestId: "wrong",
          shopDate: "2026-11-05",
          archivePath: "notes/2026-11-05.zip",
          summary: "kept off the digest path",
        },
        {
          digestId: "blank",
          shopDate: "2026-11-04",
          archivePath: "digests/2026-11-04.zip",
          summary: "   ",
        },
        {
          digestId: "huge",
          shopDate: "2026-11-03",
          archivePath: "digests/2026-11-03.zip",
          summary: "x".repeat(12_001),
        },
        {
          digestId: "bad-date",
          shopDate: "2026-11-02/../other",
          archivePath: "digests/2026-11-02.zip",
          summary: "do not follow this path",
        },
      ],
      archiveExists: async () => false,
      reportsForDigest: async () => [],
      putArchive: put,
      recordArchive: async () => {},
      clearLoosePictures: async () => 0,
      listObjects: async () => [],
      referencedPaths: async () => [],
      removeObjects: async () => {},
    });
    expect(put).not.toHaveBeenCalled();
    expect(counts.archivesRebuilt).toBe(0);
    expect(counts.archivesFailed).toBe(1);
  });

  it("packs a summary by itself when that is all that remains", () => {
    const bytes = staffFeedbackSummaryArchive("Tax shows twice.", "2026-11-05");
    expect(strFromU8(unzipSync(bytes)["manifest.txt"] ?? new Uint8Array())).toBe(
      "Tax shows twice."
    );
  });
});
