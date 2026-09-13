import { describe, expect, it } from "vitest";
import { mapTwilioCallStatus } from "@/lib/twilio/voiceStatusMap";

describe("mapTwilioCallStatus", () => {
  it("maps Twilio CallStatus values onto phone_call statuses", () => {
    expect(mapTwilioCallStatus("ringing")).toBe("ringing");
    expect(mapTwilioCallStatus("in-progress")).toBe("in_progress");
    expect(mapTwilioCallStatus("completed")).toBe("completed");
    expect(mapTwilioCallStatus("busy")).toBe("busy");
    expect(mapTwilioCallStatus("failed")).toBe("failed");
    expect(mapTwilioCallStatus("canceled")).toBe("failed");
  });

  it("treats inbound no-answer as missed and outbound no-answer as no_answer", () => {
    expect(mapTwilioCallStatus("no-answer", { direction: "inbound" })).toBe("missed");
    expect(mapTwilioCallStatus("no-answer", { direction: "outbound" })).toBe("no_answer");
  });
});
