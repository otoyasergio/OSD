import { describe, expect, it } from "vitest";
import {
  isEligiblePreviewTechnician,
  isRolePreviewRole,
  resolveReadSubject,
  resolveRolePreviewSelection,
  ROLE_PREVIEW_ROLES,
  type PreviewTechnician,
} from "@/lib/auth/role-preview-shared";
import { staffHomePath } from "@/lib/permissions/checks";

const TECH: PreviewTechnician = {
  user_id: "tech-1",
  first_name: "Tara",
  last_name: "TechA",
  role: "technician",
  status: "active",
  at_active_location: true,
};

describe("role preview allowlist", () => {
  it("allows exactly owner, service advisor, admin, and technician", () => {
    expect([...ROLE_PREVIEW_ROLES]).toEqual([
      "owner",
      "service_advisor",
      "admin",
      "technician",
    ]);
    expect(isRolePreviewRole("service_advisor")).toBe(true);
    expect(isRolePreviewRole("technician")).toBe(true);
    for (const rejected of ["manager", "head_tech", "time_clock_kiosk", "", null, 4]) {
      expect(isRolePreviewRole(rejected)).toBe(false);
    }
  });
});

describe("resolveRolePreviewSelection", () => {
  it("ignores preview cookies for every non-owner persisted role", () => {
    for (const actorRole of [
      "manager",
      "service_advisor",
      "technician",
      "head_tech",
      "admin",
      "time_clock_kiosk",
    ] as const) {
      expect(
        resolveRolePreviewSelection({
          actorRole,
          cookieRole: "admin",
          cookieTechnicianId: null,
        })
      ).toBeNull();
    }
  });

  it("treats missing, owner, or unsupported cookie roles as no preview", () => {
    for (const cookieRole of [null, undefined, "", "owner", "manager", "head_tech"]) {
      expect(
        resolveRolePreviewSelection({
          actorRole: "owner",
          cookieRole,
          cookieTechnicianId: "tech-1",
        })
      ).toBeNull();
    }
  });

  it("returns non-technician previews without a technician id", () => {
    expect(
      resolveRolePreviewSelection({
        actorRole: "owner",
        cookieRole: "service_advisor",
        cookieTechnicianId: "tech-1",
      })
    ).toEqual({ role: "service_advisor", technicianId: null });
    expect(
      resolveRolePreviewSelection({
        actorRole: "owner",
        cookieRole: "admin",
        cookieTechnicianId: null,
      })
    ).toEqual({ role: "admin", technicianId: null });
  });

  it("requires a technician id for technician preview", () => {
    for (const cookieTechnicianId of [null, undefined, "", "   "]) {
      expect(
        resolveRolePreviewSelection({
          actorRole: "owner",
          cookieRole: "technician",
          cookieTechnicianId,
        })
      ).toBeNull();
    }
    expect(
      resolveRolePreviewSelection({
        actorRole: "owner",
        cookieRole: "technician",
        cookieTechnicianId: " tech-1 ",
      })
    ).toEqual({ role: "technician", technicianId: "tech-1" });
  });
});

describe("isEligiblePreviewTechnician", () => {
  it("accepts an active regular technician at the active location", () => {
    expect(isEligiblePreviewTechnician(TECH)).toBe(true);
  });

  it("rejects head techs, inactive staff, other locations, and missing rows", () => {
    expect(isEligiblePreviewTechnician({ ...TECH, role: "head_tech" })).toBe(false);
    expect(isEligiblePreviewTechnician({ ...TECH, role: "service_advisor" })).toBe(false);
    expect(isEligiblePreviewTechnician({ ...TECH, status: "suspended" })).toBe(false);
    expect(isEligiblePreviewTechnician({ ...TECH, at_active_location: false })).toBe(
      false
    );
    expect(isEligiblePreviewTechnician(null)).toBe(false);
    expect(isEligiblePreviewTechnician(undefined)).toBe(false);
  });
});

describe("resolveReadSubject", () => {
  const owner = { role: "owner", user_id: "owner-1" } as const;

  it("defaults to the actor when no view is supplied", () => {
    expect(resolveReadSubject(owner)).toEqual({ role: "owner", userId: "owner-1" });
    expect(resolveReadSubject(owner, null)).toEqual({
      role: "owner",
      userId: "owner-1",
    });
  });

  it("mirrors the selected technician for an owner", () => {
    expect(
      resolveReadSubject(owner, { role: "technician", subjectUserId: "tech-1" })
    ).toEqual({ role: "technician", userId: "tech-1" });
  });

  it("keeps the actor id while reshaping only the role", () => {
    expect(
      resolveReadSubject(owner, { role: "admin", subjectUserId: "owner-1" })
    ).toEqual({ role: "admin", userId: "owner-1" });
  });

  it("falls back to the actor when the actor may not read another user's load", () => {
    const technician = { role: "technician", user_id: "tech-2" } as const;
    expect(
      resolveReadSubject(technician, { role: "technician", subjectUserId: "tech-1" })
    ).toEqual({ role: "technician", userId: "tech-2" });

    const admin = { role: "admin", user_id: "admin-1" } as const;
    expect(
      resolveReadSubject(admin, { role: "technician", subjectUserId: "tech-1" })
    ).toEqual({ role: "admin", userId: "admin-1" });
  });
});

describe("preview role homes", () => {
  it("lands each preview role on its own home surface", () => {
    expect(staffHomePath("owner")).toBe("/dashboard");
    expect(staffHomePath("service_advisor")).toBe("/dashboard");
    expect(staffHomePath("admin")).toBe("/dashboard");
    expect(staffHomePath("technician")).toBe("/technician");
  });
});
