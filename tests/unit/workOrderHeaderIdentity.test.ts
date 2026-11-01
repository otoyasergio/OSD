/** @vitest-environment jsdom */
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WorkOrderHeader } from "@/components/work_orders/WorkOrderHeader";
import type { WorkOrderDetail } from "@/lib/services/workOrders";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));

function detail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    work_order_id: "ae000000-0000-4000-8000-000000000001",
    motorcycle_id: "ad000000-0000-4000-8000-000000000001",
    customer_id: "ac000000-0000-4000-8000-000000000001",
    location_id: "aa000000-0000-4000-8000-000000000001",
    work_order_number: "WO-QA-0001",
    external_invoice_number: null,
    status: "open",
    primary_technician_id: null,
    created_by_user_id: null,
    date_created: "2026-07-15T12:00:00.000Z",
    estimated_completion: null,
    mileage: 12034,
    mileage_unit: "km",
    internal_notes: null,
    quality_checked_by_user_id: null,
    quality_checked_at: null,
    quality_check_notes: null,
    quality_check_assigned_to: null,
    safety_checked_by_user_id: null,
    safety_checked_at: null,
    safety_check_notes: null,
    safety_required: null,
    safety_waived: false,
    ready_for_pickup_at: null,
    completed_at: null,
    released_by_user_id: null,
    pickup_notes: null,
    checkout_evidence_required: false,
    checkout_evidence_override_at: null,
    checkout_evidence_override_by_user_id: null,
    checkout_evidence_override_reason: null,
    square_invoice_id: null,
    square_payment_status: null,
    square_invoice_public_url: null,
    billing_stage: "none",
    billing_amount_mode: null,
    billing_amount_cents: null,
    billing_collected_cents: 0,
    estimate_sent_at: null,
    invoice_published_at: null,
    wix_booking_id: null,
    scheduled_at: null,
    source: "walk_in",
    created_at: "2026-07-15T12:00:00.000Z",
    updated_at: "2026-07-15T12:00:00.000Z",
    customer: {
      customer_id: "ac000000-0000-4000-8000-000000000001",
      first_name: "Quinn",
      last_name: "Appleseed",
      phone: "+14165550100",
      email: "qa-customer@otomoto.invalid",
      sms_opted_out_at: null,
    },
    motorcycle: {
      motorcycle_id: "ad000000-0000-4000-8000-000000000001",
      year: 2022,
      make: "Yamaha",
      model: "MT-07",
      vin: "QA1TESTVIN0000001",
      colour: "Storm Grey",
      plate_number: "BAJA 07",
      customer_id: "ac000000-0000-4000-8000-000000000001",
    },
    primary_technician: null,
    quality_check_assignee: null,
    open_admin_flags: [],
    technicians: [],
    jobs: [],
    flags: [],
    agreement_follow_up: null,
    is_foreign_location: false,
    ...overrides,
  };
}

describe("work order header identity facts", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  function mount(element: React.ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(element);
    });
  }

  it("shows plate, VIN, mileage, owner, and colour immediately for front office", () => {
    mount(createElement(WorkOrderHeader, { detail: detail(), canViewClients: true }));

    const facts = container!.querySelector('[aria-label="Visit vehicle details"]');
    expect(facts).toBeTruthy();
    expect(facts!.closest("details")).toBeNull();
    expect(facts!.textContent).toContain("Quinn Appleseed");
    expect(facts!.textContent).toContain("BAJA 07");
    expect(facts!.textContent).toContain("QA1TESTVIN0000001");
    expect(facts!.textContent).toContain("12,034 km");
    expect(facts!.textContent).toContain("Storm Grey");
  });

  it("hides the owner name from technicians while keeping vehicle facts visible", () => {
    mount(createElement(WorkOrderHeader, { detail: detail(), canViewClients: false }));

    const facts = container!.querySelector('[aria-label="Visit vehicle details"]');
    expect(facts).toBeTruthy();
    expect(facts!.textContent).not.toContain("Quinn Appleseed");
    expect(facts!.textContent).toContain("BAJA 07");
    expect(facts!.textContent).toContain("QA1TESTVIN0000001");
    expect(facts!.textContent).toContain("12,034 km");
    expect(facts!.textContent).toContain("Storm Grey");
  });

  it("loads plate_number with the work order motorcycle", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "services", "workOrders.ts"),
      "utf8"
    );
    expect(source).toMatch(
      /motorcycle:motorcycle_id \(\s*[\s\S]*?plate_number[\s\S]*?customer_id\s*\)/
    );
  });
});
