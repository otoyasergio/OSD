import "server-only";

import { requireUser } from "@/lib/auth/session";
import { createPassportAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { canManageVehiclePassport } from "@/lib/permissions";
import { validatePassportPayload } from "@/lib/passport/privacy";
import {
  PASSPORT_PUBLIC_GRANT_COLUMNS,
  PASSPORT_PUBLIC_SNAPSHOT_COLUMNS,
  resolvePassportShareRecord,
  type ResolvedPassportShare,
} from "@/lib/passport/resolveShare";
import type { PassportSnapshotPayload } from "@/lib/passport/schema";
import { passportShareStatus } from "@/lib/passport/shareStatus";
import {
  generatePassportShareToken,
  hashPassportShareToken,
  passportShareUrl,
} from "@/lib/passport/tokens";
import { toRpcErrorCode } from "@/lib/services/errors";

export type PassportShareSummary = {
  share_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

export type PassportSnapshotSummary = {
  snapshot_id: string;
  version: number;
  payload: PassportSnapshotPayload;
  payload_sha256: string;
  coverage_through: string;
  issued_at: string;
};

export type VehiclePassportManagement = {
  passport: {
    passport_id: string;
    passport_number: string;
    status: "active" | "suspended";
  } | null;
  currentSnapshot: PassportSnapshotSummary | null;
  shares: PassportShareSummary[];
};

export type CreatedPassportShare = {
  shareId: string;
  url: string;
  expiresAt: string;
};

async function requirePassportManager() {
  const user = await requireUser();
  if (!canManageVehiclePassport(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function getVehiclePassportManagement(
  motorcycleId: string
): Promise<VehiclePassportManagement> {
  await requirePassportManager();
  const supabase = await createClient();
  const passportResult = await supabase
    .from("vehicle_passport")
    .select("passport_id, passport_number, status")
    .eq("motorcycle_id", motorcycleId)
    .maybeSingle();
  if (passportResult.error) throw passportResult.error;
  if (!passportResult.data) {
    return { passport: null, currentSnapshot: null, shares: [] };
  }

  const passport = passportResult.data as VehiclePassportManagement["passport"];
  const snapshotResult = await supabase
    .from("vehicle_passport_snapshot")
    .select("snapshot_id, version, payload, payload_sha256, coverage_through, issued_at")
    .eq("passport_id", passport!.passport_id)
    .is("superseded_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotResult.error) throw snapshotResult.error;
  if (!snapshotResult.data) {
    return { passport, currentSnapshot: null, shares: [] };
  }

  const currentSnapshot: PassportSnapshotSummary = {
    snapshot_id: snapshotResult.data.snapshot_id,
    version: Number(snapshotResult.data.version),
    payload: validatePassportPayload(snapshotResult.data.payload),
    payload_sha256: snapshotResult.data.payload_sha256,
    coverage_through: snapshotResult.data.coverage_through,
    issued_at: snapshotResult.data.issued_at,
  };
  const sharesResult = await supabase
    .from("vehicle_passport_share")
    .select("share_id, expires_at, revoked_at, created_at")
    .eq("snapshot_id", currentSnapshot.snapshot_id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (sharesResult.error) throw sharesResult.error;

  return {
    passport,
    currentSnapshot,
    shares: (sharesResult.data ?? []) as PassportShareSummary[],
  };
}

export async function createPassportShare(
  snapshotId: string
): Promise<CreatedPassportShare> {
  const actor = await requirePassportManager();
  const supabase = await createClient();
  const snapshotResult = await supabase
    .from("vehicle_passport_snapshot")
    .select("passport_id")
    .eq("snapshot_id", snapshotId)
    .maybeSingle();
  if (snapshotResult.error) throw snapshotResult.error;
  if (!snapshotResult.data) throw new Error("PASSPORT_SNAPSHOT_NOT_CURRENT");
  const passportResult = await supabase
    .from("vehicle_passport")
    .select("motorcycle_id")
    .eq("passport_id", snapshotResult.data.passport_id)
    .maybeSingle();
  if (passportResult.error) throw passportResult.error;
  if (!passportResult.data) throw new Error("PASSPORT_SNAPSHOT_NOT_CURRENT");
  const motorcycleResult = await supabase
    .from("motorcycle")
    .select("customer_id")
    .eq("motorcycle_id", passportResult.data.motorcycle_id)
    .maybeSingle();
  if (motorcycleResult.error) throw motorcycleResult.error;
  if (!motorcycleResult.data) throw new Error("MOTORCYCLE_NOT_FOUND");

  const { token, hash } = generatePassportShareToken();
  const admin = createPassportAdminClient();
  const { data, error } = await admin.rpc("create_vehicle_passport_share", {
    p_actor_user_id: actor.user_id,
    p_snapshot_id: snapshotId,
    p_expected_customer_id: motorcycleResult.data.customer_id,
    p_token_hash: hash,
  });
  if (error) throw new Error(toRpcErrorCode(error));

  const result = (Array.isArray(data) ? data[0] : data) as {
    created_share_id: string;
    created_expires_at: string;
  } | null;
  if (!result) throw new Error("PASSPORT_SHARE_CREATE_FAILED");

  return {
    shareId: result.created_share_id,
    url: passportShareUrl(token),
    expiresAt: result.created_expires_at,
  };
}

export async function revokePassportShare(shareId: string): Promise<void> {
  const actor = await requirePassportManager();
  const admin = createPassportAdminClient();
  const { error } = await admin.rpc("revoke_vehicle_passport_share", {
    p_actor_user_id: actor.user_id,
    p_share_id: shareId,
  });
  if (error) throw new Error(toRpcErrorCode(error));
}

export async function resolvePublicPassportShare(
  token: string
): Promise<ResolvedPassportShare | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const admin = createPassportAdminClient();
  const grantResult = await admin
    .from("vehicle_passport_share")
    .select(PASSPORT_PUBLIC_GRANT_COLUMNS)
    .eq("token_hash", hashPassportShareToken(token))
    .maybeSingle();
  if (grantResult.error) throw grantResult.error;
  if (!grantResult.data || passportShareStatus(grantResult.data) !== "active") {
    return null;
  }

  const snapshotResult = await admin
    .from("vehicle_passport_snapshot")
    .select(PASSPORT_PUBLIC_SNAPSHOT_COLUMNS)
    .eq("snapshot_id", grantResult.data.snapshot_id)
    .maybeSingle();
  if (snapshotResult.error) throw snapshotResult.error;
  if (!snapshotResult.data) return null;

  const passportResult = await admin
    .from("vehicle_passport")
    .select("status")
    .eq("passport_id", snapshotResult.data.passport_id)
    .maybeSingle();
  if (passportResult.error) throw passportResult.error;
  if (!passportResult.data) return null;

  return resolvePassportShareRecord({
    share_id: grantResult.data.share_id,
    expires_at: grantResult.data.expires_at,
    revoked_at: grantResult.data.revoked_at,
    snapshot: {
      snapshot_id: snapshotResult.data.snapshot_id,
      payload: snapshotResult.data.payload,
      payload_sha256: snapshotResult.data.payload_sha256,
      superseded_at: snapshotResult.data.superseded_at,
      passport_status: passportResult.data.status,
    },
  });
}
