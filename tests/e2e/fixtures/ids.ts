/**
 * Frozen synthetic-shop fixture constants shared by seeding, auth helpers,
 * and E2E specs. Every UUID is fixed so seeding is idempotent (upsert on PK)
 * and teardown can delete exactly these rows and nothing else.
 *
 * All values are QA-only synthetics: `.invalid` emails cannot receive mail
 * and the +1416555xxxx phone range is reserved for fiction/testing.
 */

/** Password for every fixture auth user. */
export const FIXTURE_PASSWORD = process.env.E2E_FIXTURE_PASSWORD ?? "Otomoto-QA-2026!";

/** Location the whole synthetic dataset lives in (guard enforces 'QA'). */
export const FIXTURE_LOCATION_CODE = "QA";

export const QA_LOCATION = Object.freeze({
  id: "aa000000-0000-4000-8000-000000000001",
  code: "QA",
  name: "QA Synthetic",
});

/** Second location with no fixture members; used for cross-location tests. */
export const QB_LOCATION = Object.freeze({
  id: "aa000000-0000-4000-8000-000000000002",
  code: "QB",
  name: "QB Synthetic",
});

export type FixtureRole =
  "advisor" | "techA" | "techB" | "headTech" | "manager" | "owner" | "suspended";

export type FixtureUser = Readonly<{
  /** Used for both auth.users.id and app_user.user_id / auth_user_id. */
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** app_user.role value. */
  appRole: "owner" | "manager" | "service_advisor" | "technician" | "head_tech";
  /** app_user.status value ('suspended' users must not be able to sign in). */
  status: "active" | "suspended";
}>;

export const FIXTURE_USERS: Readonly<Record<FixtureRole, FixtureUser>> = Object.freeze({
  advisor: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000001",
    email: "qa-advisor@otomoto.invalid",
    firstName: "Ava",
    lastName: "Advisor",
    appRole: "service_advisor",
    status: "active",
  } as const),
  techA: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000002",
    email: "qa-tech-a@otomoto.invalid",
    firstName: "Tara",
    lastName: "TechA",
    appRole: "technician",
    status: "active",
  } as const),
  techB: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000003",
    email: "qa-tech-b@otomoto.invalid",
    firstName: "Theo",
    lastName: "TechB",
    appRole: "technician",
    status: "active",
  } as const),
  headTech: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000004",
    email: "qa-head-tech@otomoto.invalid",
    firstName: "Hana",
    lastName: "HeadTech",
    appRole: "head_tech",
    status: "active",
  } as const),
  manager: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000005",
    email: "qa-manager@otomoto.invalid",
    firstName: "Mori",
    lastName: "Manager",
    appRole: "manager",
    status: "active",
  } as const),
  owner: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000006",
    email: "qa-owner@otomoto.invalid",
    firstName: "Omar",
    lastName: "Owner",
    appRole: "owner",
    status: "active",
  } as const),
  suspended: Object.freeze({
    id: "ab000000-0000-4000-8000-000000000007",
    email: "qa-suspended@otomoto.invalid",
    firstName: "Sam",
    lastName: "Suspended",
    appRole: "technician",
    status: "suspended",
  } as const),
});

export const FIXTURE_ROLES = Object.freeze(Object.keys(FIXTURE_USERS) as FixtureRole[]);

export const FIXTURE_CUSTOMER = Object.freeze({
  id: "ac000000-0000-4000-8000-000000000001",
  firstName: "Quinn",
  lastName: "Appleseed",
  email: "qa-customer@otomoto.invalid",
  phone: "+14165550100",
});

export const FIXTURE_MOTORCYCLE = Object.freeze({
  id: "ad000000-0000-4000-8000-000000000001",
  year: 2022,
  make: "Yamaha",
  model: "MT-07",
  vin: "QA1TESTVIN0000001",
  colour: "Storm Grey",
});

export const FIXTURE_WORK_ORDER = Object.freeze({
  id: "ae000000-0000-4000-8000-000000000001",
  number: "WO-QA-0001",
  status: "open",
  mileage: 12034,
});

export const DROP_OFF_AGREEMENT_ID = "bc000000-0000-4000-8000-000000000001";

/** Ontario HST applied to estimates. */
export const HST_RATE = 0.13;

export type FixtureService = Readonly<{
  id: string;
  name: string;
}>;

export const SERVICE_A: FixtureService = Object.freeze({
  id: "af000000-0000-4000-8000-000000000001",
  name: "QA Brake Overhaul (Itemized)",
});

export const SERVICE_B: FixtureService = Object.freeze({
  id: "af000000-0000-4000-8000-000000000002",
  name: "QA Winterize Package (Fixed)",
});

export const SERVICE_C: FixtureService = Object.freeze({
  id: "af000000-0000-4000-8000-000000000003",
  name: "QA Chain Adjustment (Declinable)",
});

/**
 * Job money is expressed in integer cents; the legacy schema stores
 * `standard_price_snapshot` as numeric dollars, so seeding writes cents/100.
 */
export const JOB_A = Object.freeze({
  id: "ba000000-0000-4000-8000-000000000001",
  serviceId: SERVICE_A.id,
  name: SERVICE_A.name,
  pricingMode: "itemized",
  labourCents: 20_000,
  partsCents: 5_000,
  feeCents: 1_000,
  totalCents: 26_000,
  /** Seeded job status. */
  status: "approved",
});

export const JOB_B = Object.freeze({
  id: "ba000000-0000-4000-8000-000000000002",
  serviceId: SERVICE_B.id,
  name: SERVICE_B.name,
  pricingMode: "fixed",
  packageCents: 10_000,
  totalCents: 10_000,
  status: "approved",
});

/** Presented on the estimate; specs decline this one. */
export const JOB_C = Object.freeze({
  id: "ba000000-0000-4000-8000-000000000003",
  serviceId: SERVICE_C.id,
  name: SERVICE_C.name,
  pricingMode: "itemized",
  labourCents: 5_000,
  totalCents: 5_000,
  status: "waiting_for_approval",
});

export const FIXTURE_JOBS = Object.freeze([JOB_A, JOB_B, JOB_C]);

/** Expected estimate math (all integer cents, HST 13%). */
export const ESTIMATE_TOTALS = Object.freeze({
  presentedSubtotalCents: 41_000,
  presentedHstCents: 5_330,
  presentedTotalCents: 46_330,
  /** Accepted = JOB_A + JOB_B once JOB_C is declined. */
  acceptedSubtotalCents: 36_000,
  acceptedHstCents: 4_680,
  acceptedTotalCents: 40_680,
});

export const PART_A = Object.freeze({
  id: "bb000000-0000-4000-8000-000000000001",
  jobId: JOB_A.id,
  name: "QA Brake Pads",
  quantity: 1,
  status: "in_stock",
  unitPriceCents: 5_000,
});

/** Open time-clock punches seeded for on-the-floor staff. */
export const TIME_CLOCK_ENTRIES = Object.freeze({
  techA: "bd000000-0000-4000-8000-000000000001",
  techB: "bd000000-0000-4000-8000-000000000002",
  headTech: "bd000000-0000-4000-8000-000000000003",
});
