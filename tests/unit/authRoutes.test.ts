import { describe, expect, it } from "vitest";
import { isPublicAppPath, safeNextPath } from "@/lib/auth/routes";

describe("auth route helpers", () => {
  it("only marks intentional anonymous routes as public", () => {
    expect(isPublicAppPath("/login")).toBe(true);
    expect(isPublicAppPath("/c/customer-token")).toBe(true);
    expect(isPublicAppPath("/api/twilio/webhooks")).toBe(true);
    expect(isPublicAppPath("/dashboard")).toBe(false);
    expect(isPublicAppPath("/control-center")).toBe(false);
    expect(isPublicAppPath("/new-staff-route")).toBe(false);
  });

  it("accepts local post-login destinations", () => {
    expect(safeNextPath("/work_orders/123?tab=jobs")).toBe("/work_orders/123?tab=jobs");
  });

  it("rejects external and recursive login redirects", () => {
    expect(safeNextPath("https://example.com")).toBe("/");
    expect(safeNextPath("//example.com")).toBe("/");
    expect(safeNextPath("/\\\\example.com")).toBe("/");
    expect(safeNextPath("/login?next=/dashboard")).toBe("/");
  });
});
