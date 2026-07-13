import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodFieldErrors } from "@/lib/validation/fieldErrors";
import { sanitizeContractHtml } from "@/lib/security/sanitizeHtml";

describe("zodFieldErrors", () => {
  it("maps first issue per path", () => {
    const schema = z.object({
      first_name: z.string().min(1, "First name is required"),
      email: z.string().email("Invalid email"),
    });
    const result = schema.safeParse({ first_name: "", email: "bad" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const fields = zodFieldErrors(result.error);
    expect(fields.first_name).toBe("First name is required");
    expect(fields.email).toBe("Invalid email");
  });
});

describe("sanitizeContractHtml", () => {
  it("strips script tags", () => {
    const dirty = '<p>Hello</p><script>alert(1)</script><a href="https://x.test">x</a>';
    const clean = sanitizeContractHtml(dirty);
    expect(clean).toContain("<p>Hello</p>");
    expect(clean).not.toContain("script");
    expect(clean).toContain("https://x.test");
  });
});
