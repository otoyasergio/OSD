import { describe, expect, it } from "vitest";
import { buildHrmsSuggestions } from "@/lib/services/hrmsSuggestions";

describe("buildHrmsSuggestions", () => {
  it("flags OT, missing PIN, and meal misses", () => {
    const suggestions = buildHrmsSuggestions({
      staff: [
        {
          user_id: "u1",
          display_name: "Alex Tech",
          paid_hours: 46,
          ot_hours: 2,
          meal_misses: 1,
          open_punch_hours: null,
          has_pin: false,
          has_employment_start_date: false,
          has_excess_hours_agreement_doc: false,
          has_vacation_record_doc: false,
          role: "technician",
        },
      ],
    });
    const ids = suggestions.map((s) => s.id);
    expect(ids).toContain("ot-u1");
    expect(ids).toContain("meal-u1");
    expect(ids).toContain("pin-u1");
    expect(ids).toContain("start-u1");
  });

  it("flags staff nearing 37.5 hours to tell supervisor", () => {
    const suggestions = buildHrmsSuggestions({
      staff: [
        {
          user_id: "u3",
          display_name: "Jordan",
          paid_hours: 38,
          ot_hours: 0,
          meal_misses: 0,
          open_punch_hours: null,
          has_pin: true,
          has_employment_start_date: true,
          has_excess_hours_agreement_doc: true,
          has_vacation_record_doc: true,
          role: "technician",
        },
      ],
    });
    expect(suggestions.some((s) => s.id === "near-week-u3")).toBe(true);
  });

  it("flags open punches over 12 hours", () => {
    const suggestions = buildHrmsSuggestions({
      staff: [
        {
          user_id: "u2",
          display_name: "Sam",
          paid_hours: 8,
          ot_hours: 0,
          meal_misses: 0,
          open_punch_hours: 14,
          has_pin: true,
          has_employment_start_date: true,
          has_excess_hours_agreement_doc: true,
          has_vacation_record_doc: true,
          role: "technician",
        },
      ],
    });
    expect(suggestions.some((s) => s.id === "open-u2")).toBe(true);
  });
});
