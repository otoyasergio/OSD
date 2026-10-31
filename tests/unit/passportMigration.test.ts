import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");

function vehiclePassportMigration(): string {
  const filename = readdirSync(migrationsDirectory).find((entry) =>
    entry.endsWith("_vehicle_passport.sql")
  );
  if (!filename) throw new Error("vehicle passport migration is missing");
  return readFileSync(join(migrationsDirectory, filename), "utf8");
}

describe("vehicle passport migration", () => {
  it("creates the registry, immutable snapshots, sources, and hashed share grants", () => {
    const sql = vehiclePassportMigration();

    for (const table of [
      "vehicle_passport",
      "vehicle_passport_snapshot",
      "vehicle_passport_snapshot_source",
      "vehicle_passport_share",
    ]) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }

    expect(sql).toContain("PASSPORT_SNAPSHOT_IMMUTABLE");
    expect(sql).toContain("token_hash text NOT NULL UNIQUE");
    expect(sql).not.toMatch(/token\s+text/i);
  });

  it("keeps anonymous users off passport tables and grants front-office access explicitly", () => {
    const sql = vehiclePassportMigration();

    expect(sql).toContain("REVOKE ALL ON TABLE");
    expect(sql).toContain("FROM anon");
    expect(sql).toContain("TO authenticated");
    expect(sql).toContain("'owner', 'manager', 'service_advisor'");
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*TO anon/);
  });

  it("indexes the active token, passport version, motorcycle, and source work order paths", () => {
    const sql = vehiclePassportMigration();

    expect(sql).toContain("idx_vehicle_passport_motorcycle");
    expect(sql).toContain("uq_vehicle_passport_snapshot_version");
    expect(sql).toContain("idx_vehicle_passport_share_active_token");
    expect(sql).toContain("uq_vehicle_passport_snapshot_source_work_order");
  });

  it("publishes one validated version and its source links transactionally", () => {
    const sql = vehiclePassportMigration();

    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.publish_vehicle_passport_snapshot"
    );
    expect(sql).toContain("p_actor_user_id uuid");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("PASSPORT_VERSION_CONFLICT");
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.read_vehicle_passport_source"
    );
    expect(sql).toContain("p_source_sha256 text");
    expect(sql).toContain("PASSPORT_SOURCE_CHANGED");
    expect(sql).toContain("FROM public.job_part_requirement");
    expect(sql).toContain("FOR SHARE");
    expect(sql).toContain("p_location_ids uuid[]");
    expect(sql).toContain("location_id = ANY(p_location_ids)");
    expect(sql).toContain("ARRAY(SELECT public.user_location_ids())");
    expect(sql).toContain("FROM public.user_location");
    expect(sql).toContain("SELECT motorcycle.customer_id");
    expect(sql.match(/extensions\.digest\(v_source::text/g)).toHaveLength(2);
    expect(sql).not.toContain("encode(digest(v_source::text");
    expect(sql).toContain("unnest(p_work_order_ids)");
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain("v_issued_at := (p_payload ->> 'issued_at')::timestamptz");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.publish_vehicle_passport_snapshot"
    );
    expect(sql).toContain(
      "uuid, uuid, text, integer, jsonb, text, text, timestamptz, uuid[]\n) TO service_role;"
    );
    expect(sql).not.toContain(
      "uuid, uuid, text, integer, jsonb, text, text, timestamptz, uuid[]\n) TO authenticated"
    );
    expect(sql).toContain(
      "GRANT SELECT ON TABLE public.vehicle_passport_snapshot TO authenticated"
    );
    expect(sql).not.toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.vehicle_passport_snapshot TO authenticated"
    );
  });

  it("creates and revokes one current seven-day share through guarded commands", () => {
    const sql = vehiclePassportMigration();

    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.create_vehicle_passport_share"
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.revoke_vehicle_passport_share"
    );
    expect(sql).toContain("PASSPORT_SNAPSHOT_NOT_CURRENT");
    expect(sql).toContain("v_expires_at := v_now + interval '7 days'");
    expect(sql).toContain("expires_at = created_at + interval '7 days'");
    expect(sql).toContain("p_expected_customer_id uuid");
    expect(sql).toContain("PASSPORT_OWNER_CHANGED");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.create_vehicle_passport_share"
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.revoke_vehicle_passport_share"
    );
    expect(sql).toContain("uuid, uuid, uuid, text\n) TO service_role;");
    expect(sql).not.toContain("uuid, uuid, uuid, text\n) TO authenticated");
  });

  it("revokes active grants inside every motorcycle owner change transaction", () => {
    const sql = vehiclePassportMigration();

    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.vehicle_passport_revoke_on_owner_change"
    );
    expect(sql).toContain("AFTER UPDATE OF customer_id ON public.motorcycle");
    expect(sql).toContain("revocation_reason = 'ownership_transfer'");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.vehicle_passport_revoke_on_owner_change()"
    );
  });
});
