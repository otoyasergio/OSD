import { describe, expect, it } from "vitest";
import {
  legacyWritesRequired,
  readWorkflowV2Flags,
  v2ReadEnabledForLocation,
  v2ShadowReadEnabled,
  v2WritesEnabled,
} from "@/lib/config/features";

describe("workflow V2 feature flags", () => {
  it("defaults to fully legacy with no env", () => {
    const flags = readWorkflowV2Flags({});
    expect(flags).toEqual({
      readMode: "legacy",
      writeMode: "legacy",
      locationCodes: [],
      killSwitch: false,
    });
    expect(v2WritesEnabled(flags)).toBe(false);
    expect(v2ShadowReadEnabled(flags)).toBe(false);
    expect(v2ReadEnabledForLocation(flags, "QA")).toBe(false);
    expect(legacyWritesRequired(flags)).toBe(true);
  });

  it("parses modes case-insensitively and rejects unknown values", () => {
    expect(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_READ_MODE: "Shadow" }).readMode).toBe(
      "shadow"
    );
    expect(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: " DUAL " }).writeMode).toBe(
      "dual"
    );
    expect(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_READ_MODE: "banana" }).readMode).toBe(
      "legacy"
    );
    expect(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: "on" }).writeMode).toBe(
      "legacy"
    );
  });

  it("kill switch forces legacy regardless of other flags", () => {
    const flags = readWorkflowV2Flags({
      JOBS_ESTIMATE_V2_KILL_SWITCH: "1",
      JOBS_ESTIMATE_V2_READ_MODE: "v2",
      JOBS_ESTIMATE_V2_WRITE_MODE: "v2",
      JOBS_ESTIMATE_V2_LOCATION_CODES: "QA,TOR",
    });
    expect(flags.killSwitch).toBe(true);
    expect(flags.readMode).toBe("legacy");
    expect(flags.writeMode).toBe("legacy");
    expect(v2WritesEnabled(flags)).toBe(false);
    expect(v2ShadowReadEnabled(flags)).toBe(false);
    expect(v2ReadEnabledForLocation(flags, "QA")).toBe(false);
    expect(legacyWritesRequired(flags)).toBe(true);
  });

  it("enables writes in dual and v2 modes only", () => {
    expect(
      v2WritesEnabled(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: "legacy" }))
    ).toBe(false);
    expect(
      v2WritesEnabled(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: "dual" }))
    ).toBe(true);
    expect(
      v2WritesEnabled(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: "v2" }))
    ).toBe(true);
  });

  it("keeps legacy writes required until write mode is fully v2", () => {
    expect(
      legacyWritesRequired(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: "dual" }))
    ).toBe(true);
    expect(
      legacyWritesRequired(readWorkflowV2Flags({ JOBS_ESTIMATE_V2_WRITE_MODE: "v2" }))
    ).toBe(false);
  });

  it("shadow mode reads V2 without serving it", () => {
    const flags = readWorkflowV2Flags({ JOBS_ESTIMATE_V2_READ_MODE: "shadow" });
    expect(v2ShadowReadEnabled(flags)).toBe(true);
    expect(v2ReadEnabledForLocation(flags, "QA")).toBe(false);
  });

  it("scopes v2 reads to the location allow-list", () => {
    const flags = readWorkflowV2Flags({
      JOBS_ESTIMATE_V2_READ_MODE: "v2",
      JOBS_ESTIMATE_V2_LOCATION_CODES: "qa, tor",
    });
    expect(flags.locationCodes).toEqual(["QA", "TOR"]);
    expect(v2ReadEnabledForLocation(flags, "QA")).toBe(true);
    expect(v2ReadEnabledForLocation(flags, "qa")).toBe(true);
    expect(v2ReadEnabledForLocation(flags, "TOR")).toBe(true);
    expect(v2ReadEnabledForLocation(flags, "QB")).toBe(false);
    expect(v2ReadEnabledForLocation(flags, null)).toBe(false);
    expect(v2ReadEnabledForLocation(flags, undefined)).toBe(false);
  });

  it("empty allow-list means every location once read mode is v2", () => {
    const flags = readWorkflowV2Flags({ JOBS_ESTIMATE_V2_READ_MODE: "v2" });
    expect(v2ReadEnabledForLocation(flags, "TOR")).toBe(true);
    expect(v2ReadEnabledForLocation(flags, "ANYTHING")).toBe(true);
    // Still requires an actual location for a scoped read decision.
    expect(v2ReadEnabledForLocation(flags, null)).toBe(true);
  });
});
