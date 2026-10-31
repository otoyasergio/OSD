import { hashPassportPayload } from "@/lib/passport/digest";
import { validatePassportPayload } from "@/lib/passport/privacy";
import type { PassportSnapshotPayload } from "@/lib/passport/schema";
import { passportShareStatus } from "@/lib/passport/shareStatus";

export const PASSPORT_PUBLIC_GRANT_COLUMNS =
  "share_id, snapshot_id, expires_at, revoked_at";
export const PASSPORT_PUBLIC_SNAPSHOT_COLUMNS =
  "snapshot_id, passport_id, payload, payload_sha256, superseded_at";

export type PassportShareDatabaseRecord = {
  share_id: string;
  expires_at: string;
  revoked_at: string | null;
  snapshot: {
    snapshot_id: string;
    payload: unknown;
    payload_sha256: string;
    superseded_at: string | null;
    passport_status: "active" | "suspended";
  };
};

export type ResolvedPassportShare = {
  payload: PassportSnapshotPayload;
  expiresAt: string;
};

export function resolvePassportShareRecord(
  record: PassportShareDatabaseRecord | null,
  now = new Date()
): ResolvedPassportShare | null {
  if (!record || passportShareStatus(record, now) !== "active") return null;
  if (record.snapshot.superseded_at || record.snapshot.passport_status !== "active") {
    return null;
  }
  if (hashPassportPayload(record.snapshot.payload) !== record.snapshot.payload_sha256) {
    return null;
  }

  try {
    return {
      payload: validatePassportPayload(record.snapshot.payload),
      expiresAt: record.expires_at,
    };
  } catch {
    return null;
  }
}
