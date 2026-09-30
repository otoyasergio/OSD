/**
 * Workflow V2 feature gates.
 *
 * Read and write modes are independent so the rollout can move through
 * legacy → dual-write → shadow-read → v2 in reversible steps. The kill
 * switch wins over everything so production can drop back to legacy
 * without a redeploy of flag values elsewhere.
 *
 * Server-only: values come from process.env at call time (no module-load
 * caching) so serverless instances honour environment changes on restart
 * and tests can vary env per case.
 */

export type V2ReadMode = "legacy" | "shadow" | "v2";
export type V2WriteMode = "legacy" | "dual" | "v2";

export type WorkflowV2Flags = {
  readMode: V2ReadMode;
  writeMode: V2WriteMode;
  /** Location codes (upper-cased) explicitly enabled for V2 reads. Empty = all. */
  locationCodes: readonly string[];
  killSwitch: boolean;
};

const READ_MODES: readonly V2ReadMode[] = ["legacy", "shadow", "v2"];
const WRITE_MODES: readonly V2WriteMode[] = ["legacy", "dual", "v2"];

function parseMode<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  const value = raw?.trim().toLowerCase();
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseLocationCodes(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export function readWorkflowV2Flags(
  env: Record<string, string | undefined> = process.env
): WorkflowV2Flags {
  const killSwitch = env.JOBS_ESTIMATE_V2_KILL_SWITCH === "1";
  if (killSwitch) {
    return { readMode: "legacy", writeMode: "legacy", locationCodes: [], killSwitch };
  }
  return {
    readMode: parseMode(env.JOBS_ESTIMATE_V2_READ_MODE, READ_MODES, "legacy"),
    writeMode: parseMode(env.JOBS_ESTIMATE_V2_WRITE_MODE, WRITE_MODES, "legacy"),
    locationCodes: parseLocationCodes(env.JOBS_ESTIMATE_V2_LOCATION_CODES),
    killSwitch: false,
  };
}

/** True when any V2 table may be written (dual or v2 write mode). */
export function v2WritesEnabled(flags: WorkflowV2Flags): boolean {
  return !flags.killSwitch && flags.writeMode !== "legacy";
}

/** True when V2 rows should be read for parity logging without serving them. */
export function v2ShadowReadEnabled(flags: WorkflowV2Flags): boolean {
  return !flags.killSwitch && flags.readMode === "shadow";
}

/**
 * True when V2 is the serving read path for this location.
 * An empty allow-list means every location once readMode is "v2".
 */
export function v2ReadEnabledForLocation(
  flags: WorkflowV2Flags,
  locationCode: string | null | undefined
): boolean {
  if (flags.killSwitch || flags.readMode !== "v2") return false;
  if (flags.locationCodes.length === 0) return true;
  const code = locationCode?.trim().toUpperCase();
  return Boolean(code && flags.locationCodes.includes(code));
}

/**
 * Legacy writes must continue until write mode is fully "v2"; dropping them
 * earlier would break rollback and old app instances during deploys.
 */
export function legacyWritesRequired(flags: WorkflowV2Flags): boolean {
  return flags.killSwitch || flags.writeMode !== "v2";
}
