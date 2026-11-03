import { afterEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  mode: "ok" as "ok" | "missing" | "duplicate" | "duplicate-lookup",
  inserted: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/audit/addAuditLog", () => ({
  addAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/database/supabase-admin", () => ({
  createBikeLinkAdminClient: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle: async () => {
          if (table === "bike_link_box") {
            if (harness.mode === "missing") return { data: null, error: null };
            return { data: { motorcycle_id: "moto-1" }, error: null };
          }
          if (harness.mode === "duplicate-lookup") {
            return { data: { reading_id: "reading-old" }, error: null };
          }
          return { data: { odometer: 40000 }, error: null };
        },
        insert(row: Record<string, unknown>) {
          harness.inserted = row;
          return {
            select() {
              return {
                single: async () => {
                  if (harness.mode === "duplicate") {
                    harness.mode = "duplicate-lookup";
                    return { data: null, error: { code: "23505", message: "duplicate" } };
                  }
                  return { data: { reading_id: "reading-new" }, error: null };
                },
              };
            },
          };
        },
      };
      return chain;
    },
  }),
}));

import { addAuditLog } from "@/lib/audit/addAuditLog";
import { POST } from "@/app/api/bike-link/readings/route";

const packet = {
  boxId: "TM-BL-0007",
  source: "shop_bay",
  placeName: "99 River Street",
  odometer: "48210",
  batteryVolts: "12.6",
  faultCodes: "P0335",
  recordedAt: "2026-11-02T21:15:00Z",
};

function post(authorization?: string) {
  return POST(
    new Request("http://localhost/api/bike-link/readings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(packet),
    })
  );
}

afterEach(() => {
  delete process.env.BIKE_LINK_INGEST_SECRET;
  harness.mode = "ok";
  harness.inserted = null;
  vi.clearAllMocks();
});

describe("POST /api/bike-link/readings", () => {
  it("returns 500 when the secret is not configured", async () => {
    const response = await post("Bearer anything");
    expect(response.status).toBe(500);
  });

  it("returns 401 when the bearer token does not match", async () => {
    process.env.BIKE_LINK_INGEST_SECRET = "shop-secret";
    const response = await post("Bearer wrong");
    expect(response.status).toBe(401);
  });

  it("stores a new reading and returns 201", async () => {
    process.env.BIKE_LINK_INGEST_SECRET = "shop-secret";
    const response = await post("Bearer shop-secret");
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      readingId: "reading-new",
      duplicate: false,
    });
    expect(harness.inserted).toMatchObject({
      motorcycle_id: "moto-1",
      box_id: "TM-BL-0007",
      recorded_by_user_id: null,
      odometer: 48210,
    });
    expect(addAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actor_user_id: null,
        action: "bike_link.reading_received",
      })
    );
  });

  it("returns the existing reading when the same box time arrives again", async () => {
    process.env.BIKE_LINK_INGEST_SECRET = "shop-secret";
    harness.mode = "duplicate";
    const response = await post("Bearer shop-secret");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      readingId: "reading-old",
      duplicate: true,
    });
    expect(addAuditLog).not.toHaveBeenCalled();
  });

  it("returns 404 for an unpaired sticker", async () => {
    process.env.BIKE_LINK_INGEST_SECRET = "shop-secret";
    harness.mode = "missing";
    const response = await post("Bearer shop-secret");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Unknown box." });
  });
});
