import { describe, expect, it } from "vitest";
import {
  INSPECTION_SAVE_CONNECTION_MESSAGE,
  INSPECTION_SAVE_FAILED_MESSAGE,
  INSPECTION_SAVE_STALE_PAGE_MESSAGE,
  describeInspectionSaveFailure,
} from "@/lib/inspections/inspectionSaveFailure";

describe("describeInspectionSaveFailure", () => {
  it("tells the tech to reload when the deployment no longer has the action", () => {
    const message = describeInspectionSaveFailure(
      new Error(
        'Server Action "00302408cfe762fce112fe5510a02f89fd39751e3a" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action'
      )
    );
    expect(message).toBe(INSPECTION_SAVE_STALE_PAGE_MESSAGE);
    expect(message).not.toContain("00302408");
  });

  it("keeps a connection drop separate from a stale page", () => {
    expect(describeInspectionSaveFailure(new TypeError("Load failed"))).toBe(
      INSPECTION_SAVE_CONNECTION_MESSAGE
    );
    expect(describeInspectionSaveFailure(new TypeError("Failed to fetch"))).toBe(
      INSPECTION_SAVE_CONNECTION_MESSAGE
    );
  });

  it("hides other thrown framework errors", () => {
    expect(describeInspectionSaveFailure(new Error('{"message":"Bad Request"}'))).toBe(
      INSPECTION_SAVE_FAILED_MESSAGE
    );
  });
});
