import { describe, expect, it } from "vitest";
import { mapTwilioCallStatus } from "@/lib/twilio/voiceStatusMap";

describe("mapTwilioCallStatus", () => {
  it("maps Twilio Voice CallStatus onto phone_call.status", () => {
    expect(mapTwilioCallStatus("queued")).toBe("ringing");
    expect(mapTwilioCallStatus("initiated")).toBe("ringing");
    expect(mapTwilioCallStatus("ringing")).toBe("ringing");
    expect(mapTwilioCallStatus("in-progress")).toBe("in_progress");
    expect(mapTwilioCallStatus("answered")).toBe("in_progress");
    expect(mapTwilioCallStatus("completed")).toBe("completed");
    expect(mapTwilioCallStatus("busy")).toBe("busy");
    expect(mapTwilioCallStatus("no-answer")).toBe("no_answer");
    expect(mapTwilioCallStatus("canceled")).toBe("missed");
    expect(mapTwilioCallStatus("failed")).toBe("failed");
  });

  it("returns null for unknown statuses", () => {
    expect(mapTwilioCallStatus("weird")).toBeNull();
    expect(mapTwilioCallStatus(undefined)).toBeNull();
  });
});
