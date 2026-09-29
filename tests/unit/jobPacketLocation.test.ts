import { beforeEach, describe, expect, it, vi } from "vitest";

const WO = "41111111-1111-4111-8111-111111111111";
const HOME = "31111111-1111-4111-8111-111111111111";
const OTHER = "32222222-2222-4222-8222-222222222222";
const TECH = "11111111-1111-4111-8111-111111111111";

const { requireUser, createClient, listTechnicianNotes } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  listTechnicianNotes: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireUser }));
vi.mock("@/lib/database/supabase-server", () => ({ createClient }));
vi.mock("@/lib/services/notes", () => ({ listTechnicianNotes }));

import { getJobPacket } from "@/lib/services/jobPacket";

function chain(result: { data: unknown; error: null }) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "order"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => result;
  query.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return query;
}

function workOrder(locationId: string) {
  return {
    work_order_id: WO,
    work_order_number: "WO-1",
    status: "in_progress",
    location_id: locationId,
    primary_technician_id: TECH,
    quality_check_assigned_to: null,
    motorcycle: { year: 2026, make: "Honda", model: "CB500F" },
    job: [
      {
        job_id: "51111111-1111-4111-8111-111111111111",
        service_name_snapshot: "Brake service",
        status: "in_progress",
        origin: null,
        assigned_technician_id: TECH,
        created_at: "2026-09-29T10:00:00.000Z",
      },
    ],
  };
}

describe("getJobPacket location flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTechnicianNotes.mockResolvedValue([]);
    requireUser.mockResolvedValue({
      user_id: TECH,
      role: "technician",
      status: "active",
      active_location_id: HOME,
      location_ids: [HOME, OTHER],
    });
  });

  function withWorkOrder(locationId: string) {
    createClient.mockResolvedValue({
      from: (table: string) =>
        chain({
          data: table === "work_order" ? workOrder(locationId) : [],
          error: null,
        }),
    });
  }

  it("marks a work order at the active location as writable", async () => {
    withWorkOrder(HOME);
    const packet = await getJobPacket(WO);
    expect(packet?.is_foreign_location).toBe(false);
  });

  it("marks a member's work order at another location as foreign", async () => {
    withWorkOrder(OTHER);
    const packet = await getJobPacket(WO);
    expect(packet?.is_foreign_location).toBe(true);
    expect(JSON.stringify(packet)).not.toContain(OTHER);
  });
});
