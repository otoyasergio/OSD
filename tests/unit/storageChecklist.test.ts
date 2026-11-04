import { describe, expect, it } from "vitest";
import { formatCalendarDate, shopDateKey } from "@/lib/datetime/format";
import { buildStorageChecklist } from "@/lib/storage/checklist";
import {
  planStorageMonthNotice,
  renderStorageMonthNotice,
  storageNoticeIsDue,
} from "@/lib/storage/notice";
import {
  formatStorageMonthlyAmount,
  parseStorageMonthlyCents,
  parseStoragePickupDate,
  storageCardTone,
  storageDaysLeft,
  storageRemainingLabel,
} from "@/lib/storage/terms";

const finished = {
  inspectionComplete: true,
  jobs: [{ jobId: "j1", name: "Oil", status: "completed" }],
  parts: [],
  phone: "6475550100",
};

describe("storage checklist", () => {
  it("blocks an open inspection", () => {
    const checklist = buildStorageChecklist({ ...finished, inspectionComplete: false });
    expect(checklist.inspectionDone).toBe(false);
    expect(checklist.canStore).toBe(false);
  });

  it("blocks work still waiting on approval", () => {
    const checklist = buildStorageChecklist({
      ...finished,
      jobs: [{ jobId: "j2", name: "Chain", status: "waiting_for_approval" }],
    });
    expect(checklist.awaitingApproval.map((line) => line.name)).toEqual(["Chain"]);
    expect(checklist.canStore).toBe(false);
  });

  it("blocks an unfinished approved job and parts still on order", () => {
    const checklist = buildStorageChecklist({
      ...finished,
      jobs: [{ jobId: "j3", name: "Brakes", status: "waiting_for_parts" }],
      parts: [{ jobId: "j3", name: "Pads", status: "ordered" }],
    });
    expect(checklist.unfinishedApproved.map((line) => line.name)).toEqual(["Brakes"]);
    expect(checklist.partsOutstanding.map((line) => line.name)).toEqual(["Pads"]);
    expect(checklist.canStore).toBe(false);
  });

  it("allows a declined-only visit after inspection", () => {
    const checklist = buildStorageChecklist({
      ...finished,
      jobs: [{ jobId: "j4", name: "Tires", status: "declined" }],
      parts: [{ jobId: "j4", name: "Tire", status: "needed" }],
    });
    expect(checklist.canStore).toBe(true);
    expect(checklist.partsOutstanding).toEqual([]);
  });

  it("flags a missing phone without blocking storage", () => {
    const checklist = buildStorageChecklist({ ...finished, phone: "  " });
    expect(checklist.phoneMissing).toBe(true);
    expect(checklist.canStore).toBe(true);
  });

  it("requires a pickup date today or later and a monthly amount", () => {
    expect(parseStoragePickupDate("2026-11-02", "2026-11-01")).toBe("2026-11-02");
    expect(parseStoragePickupDate("2026-10-31", "2026-11-01")).toBeNull();
    expect(parseStoragePickupDate("", "2026-11-01")).toBeNull();
    expect(parseStorageMonthlyCents("")).toBeNull();
    expect(parseStorageMonthlyCents("0")).toBe(0);
    expect(parseStorageMonthlyCents("$120.50")).toBe(12050);
    expect(formatStorageMonthlyAmount(0)).toBe("$0");
    expect(formatStorageMonthlyAmount(12000)).toBe("$120");
  });
});

describe("storage card tone", () => {
  it("uses the Toronto date, then green, yellow, and red by days left", () => {
    const today = shopDateKey(new Date("2026-11-01T03:30:00.000Z"));
    expect(today).toBe("2026-10-31");
    expect(storageDaysLeft("2026-11-08", today)).toBe(8);
    expect(storageCardTone(storageDaysLeft("2026-11-08", today))).toBe("ok");
    expect(storageCardTone(storageDaysLeft("2026-11-07", today))).toBe("warn");
    expect(storageCardTone(storageDaysLeft("2026-10-31", today))).toBe("late");
    expect(storageCardTone(storageDaysLeft("2026-10-29", today))).toBe("late");
    expect(storageRemainingLabel(8)).toBe("8 days left");
    expect(storageRemainingLabel(1)).toBe("1 day left");
    expect(storageRemainingLabel(0)).toBe("Due today");
    expect(storageRemainingLabel(-3)).toBe("3 days past");
  });
});

describe("storage month notice", () => {
  const base = {
    today: "2026-11-01",
    phone: "6475550100",
    email: "rider@example.com",
    smsOptedOut: false,
    smsSent: false,
    emailSent: false,
  };

  it("does not send when 31 days are left", () => {
    expect(storageNoticeIsDue("2026-12-02", "2026-11-01")).toBe(false);
    expect(planStorageMonthNotice({ ...base, pickupBy: "2026-12-02" })).toBeNull();
  });

  it("sends both channels once when 30 days are left", () => {
    const due = planStorageMonthNotice({ ...base, pickupBy: "2026-12-01" });
    expect(due).toEqual({ sms: "send", email: "send" });
    expect(
      planStorageMonthNotice({
        ...base,
        pickupBy: "2026-12-01",
        smsSent: true,
        emailSent: true,
      })
    ).toEqual({ sms: "skip_sent", email: "skip_sent" });
  });

  it("still sends the email when the phone is opted out", () => {
    expect(
      planStorageMonthNotice({
        ...base,
        pickupBy: "2026-12-01",
        smsOptedOut: true,
      })
    ).toEqual({ sms: "skip_opt_out", email: "send" });
  });

  it("names the end date and the monthly amount", () => {
    const message = renderStorageMonthNotice({
      customerName: "Ava",
      year: 2022,
      make: "Honda",
      model: "CB500F",
      pickupBy: "2026-12-01",
      monthlyCents: 15000,
    });
    const endDate = formatCalendarDate("2026-12-01");
    expect(message.sms).toContain("2022 Honda CB500F");
    expect(message.sms).toContain(endDate);
    expect(message.sms).toContain("$150");
    expect(message.emailSubject).toContain("2022 Honda CB500F");
    expect(message.emailText).toContain(endDate);
    expect(message.emailHtml).toContain("$150");
    expect(message.sms).not.toContain("WO-");
    expect(message.emailText).not.toMatch(/https?:\/\//);
  });
});
