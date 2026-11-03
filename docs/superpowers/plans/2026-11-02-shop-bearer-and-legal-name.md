# Shop bearer compare and legal name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare inbound cron and Wix bearer secrets in constant time, and render the weekly report and Wix invoice gate from the Toronto shop record.

**Architecture:** `lib/security/webhooks.ts` already compares Square and Twilio signatures with `timingSafeEqual` after a length check. Add one bearer helper there and call it from the six routes that still use `!==`. `lib/shop/toronto.ts` already owns the legal name; the weekly-report renderer and `LEGAL_ENTITY_NAME` should read that field instead of pasting the string again. No new runtime, no new UI, no Adobe project.

**Tech Stack:** Next.js route handlers, Vitest, Node `crypto.timingSafeEqual`.

## Global Constraints

- Legal entity on customer-facing documents is `OTOMOTO TORONTO MOTO INC.`, from `TORONTO_SHOP.legalName` in `lib/shop/toronto.ts`.
- Address remains `99 River Street, Toronto, ON M5A 3P4`. Phone remains `647-424-1088`. Location code remains `TOR`.
- Ottawa is inactive. Do not add an Ottawa address or operating shop.
- Customer SMS stays in Wix Inbox. Do not move `647-424-1088`.
- Production ships from `main` only, through `npm run deploy:production`. Do not run `vercel --prod`.
- Do not add an Adobe App Builder app, `aio` project, Spectrum UI, or Adobe deploy workflow.
- Do not change outbound `Authorization: Bearer` headers in `lib/partsCanada/client.ts`, `lib/email/gmail.ts`, `lib/square/client.ts`, or `scripts/sync-parts-canada.ts`. Those send a token to another service. They are not inbound secret checks.
- A correct bearer still returns the route's current success or skip response. A wrong bearer still returns 401. A missing cron secret still returns 500. A missing Wix webhook secret still returns 503.

---

### Task 1: Bearer helper

**Files:**

- Modify: `lib/security/webhooks.ts` (private `safeEqual` stays private)
- Test: `tests/unit/bearerAuthorization.test.ts`

**Interfaces:**

- Consumes: private `safeEqual(a: string, b: string): boolean` in `lib/security/webhooks.ts`
- Produces: `bearerAuthorizationMatches(authorizationHeader: string | null, secret: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/bearerAuthorization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bearerAuthorizationMatches } from "@/lib/security/webhooks";

describe("bearerAuthorizationMatches", () => {
  it("accepts an exact Bearer secret", () => {
    expect(bearerAuthorizationMatches("Bearer cron-secret", "cron-secret")).toBe(true);
  });

  it("rejects a same-length wrong secret", () => {
    expect(bearerAuthorizationMatches("Bearer cron-secret", "cron-secreX")).toBe(false);
  });

  it("rejects a different-length secret without throwing", () => {
    expect(bearerAuthorizationMatches("Bearer short", "a-much-longer-secret")).toBe(
      false
    );
  });

  it("rejects a missing header, an empty secret, and a non-Bearer scheme", () => {
    expect(bearerAuthorizationMatches(null, "cron-secret")).toBe(false);
    expect(bearerAuthorizationMatches("Bearer cron-secret", "")).toBe(false);
    expect(bearerAuthorizationMatches("Basic cron-secret", "cron-secret")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/bearerAuthorization.test.ts`

Expected: FAIL. The module has no export named `bearerAuthorizationMatches`.

- [ ] **Step 3: Add the helper**

In `lib/security/webhooks.ts`, after `safeEqual`, add:

```ts
/**
 * Inbound Authorization check for a shared secret.
 * Length is checked before timingSafeEqual, which throws on unequal buffers.
 */
export function bearerAuthorizationMatches(
  authorizationHeader: string | null,
  secret: string
): boolean {
  if (!authorizationHeader || !secret) return false;
  return safeEqual(authorizationHeader, `Bearer ${secret}`);
}
```

Do not trim the header. The current routes require the exact `Bearer <secret>` value.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/bearerAuthorization.test.ts`

Expected: PASS. 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/security/webhooks.ts tests/unit/bearerAuthorization.test.ts
git commit -m "Compare inbound bearer secrets in constant time."
```

### Task 2: Use the helper on inbound routes

**Files:**

- Modify: `app/api/cron/parts-canada-sync/route.ts`
- Modify: `app/api/cron/weekly-shop-report/route.ts`
- Modify: `app/api/cron/wix-contacts-sync/route.ts`
- Modify: `app/api/wix/webhooks/invoices/route.ts`
- Modify: `app/api/wix/webhooks/contacts/route.ts`
- Modify: `app/api/wix/webhooks/bookings/route.ts`
- Test: `tests/unit/bearerAuthorization.test.ts`
- Test: `tests/unit/weeklyShopReportCron.test.ts` (existing; must stay green)

**Interfaces:**

- Consumes: `bearerAuthorizationMatches(authorizationHeader: string | null, secret: string): boolean`
- Produces: those six routes call the helper. No response-shape change.

- [ ] **Step 1: Extend the test so it fails on the old compares**

Append this import and test to `tests/unit/bearerAuthorization.test.ts`:

```ts
import { readFileSync } from "node:fs";

const INBOUND_BEARER_ROUTES = [
  "app/api/cron/parts-canada-sync/route.ts",
  "app/api/cron/weekly-shop-report/route.ts",
  "app/api/cron/wix-contacts-sync/route.ts",
  "app/api/wix/webhooks/invoices/route.ts",
  "app/api/wix/webhooks/contacts/route.ts",
  "app/api/wix/webhooks/bookings/route.ts",
];

describe("inbound bearer routes", () => {
  it("compares the shared secret with bearerAuthorizationMatches", () => {
    for (const path of INBOUND_BEARER_ROUTES) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("bearerAuthorizationMatches(");
      expect(source, path).not.toContain("!== `Bearer");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/bearerAuthorization.test.ts`

Expected: FAIL on `inbound bearer routes`. The helper tests still pass. Each route source does not contain `bearerAuthorizationMatches(`.

- [ ] **Step 3: Switch each route**

Add this import beside the other `@/lib/security` imports in each file:

```ts
import { bearerAuthorizationMatches } from "@/lib/security/webhooks";
```

`app/api/cron/parts-canada-sync/route.ts`, replace the compare:

```ts
  if (!bearerAuthorizationMatches(authHeader, secret)) {
```

`app/api/cron/weekly-shop-report/route.ts`, replace the compare:

```ts
  if (!bearerAuthorizationMatches(authHeader, secret)) {
```

`app/api/cron/wix-contacts-sync/route.ts`, replace the compare:

```ts
  if (!bearerAuthorizationMatches(authHeader, secret)) {
```

`app/api/wix/webhooks/invoices/route.ts`, replace the compare:

```ts
  if (!bearerAuthorizationMatches(authHeader, expected)) {
```

`app/api/wix/webhooks/contacts/route.ts`, replace the compare:

```ts
  if (!bearerAuthorizationMatches(authHeader, expected)) {
```

`app/api/wix/webhooks/bookings/route.ts`, replace the compare. This route names the header `auth`:

```ts
  if (!bearerAuthorizationMatches(auth, secret)) {
```

Leave the missing-secret branches as they are. Cron returns 500 when `CRON_SECRET` is empty. Wix returns 503 when the webhook secret is missing. The helper is only the compare.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/bearerAuthorization.test.ts tests/unit/weeklyShopReportCron.test.ts`

Expected: PASS. Weekly cron still rejects `Bearer wrong` with 401 and still sends when the header is `Bearer cron-secret` at Friday 8:00 p.m. Toronto.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/parts-canada-sync/route.ts app/api/cron/weekly-shop-report/route.ts app/api/cron/wix-contacts-sync/route.ts app/api/wix/webhooks/invoices/route.ts app/api/wix/webhooks/contacts/route.ts app/api/wix/webhooks/bookings/route.ts tests/unit/bearerAuthorization.test.ts
git commit -m "Use the shared bearer check on cron and Wix webhooks."
```

### Task 3: One legal name

**Files:**

- Modify: `lib/reports/weeklyShopReport.ts` (the two literal names in `renderWeeklyShopReport`)
- Modify: `lib/wix/invoiceRules.ts` (`LEGAL_ENTITY_NAME`)
- Test: `tests/unit/weeklyShopReport.test.ts`
- Test: `tests/unit/shopIdentity.test.ts`

**Interfaces:**

- Consumes: `TORONTO_SHOP.legalName` from `lib/shop/toronto.ts`, value `OTOMOTO TORONTO MOTO INC.`
- Produces: `LEGAL_ENTITY_NAME` stays a string export and equals `TORONTO_SHOP.legalName`. `renderWeeklyShopReport` puts that same name in `message.text` and `message.html`.

- [ ] **Step 1: Write the identity test and point the report test at the shop record**

Create `tests/unit/shopIdentity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { LEGAL_ENTITY_NAME } from "@/lib/wix/invoiceRules";

describe("shop legal name", () => {
  it("uses the Toronto legal entity for Wix invoice gates", () => {
    expect(LEGAL_ENTITY_NAME).toBe(TORONTO_SHOP.legalName);
    expect(TORONTO_SHOP.legalName).toBe("OTOMOTO TORONTO MOTO INC.");
  });
});
```

In `tests/unit/weeklyShopReport.test.ts`, add:

```ts
import { TORONTO_SHOP } from "@/lib/shop/toronto";
```

In the empty-week test, replace `expect(message.html).toContain("OTOMOTO TORONTO MOTO INC.");` with:

```ts
expect(message.text.startsWith(TORONTO_SHOP.legalName)).toBe(true);
expect(message.html).toContain(TORONTO_SHOP.legalName);
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/unit/shopIdentity.test.ts tests/unit/weeklyShopReport.test.ts`

Expected: PASS. Both strings are already `OTOMOTO TORONTO MOTO INC.`, so this step locks the contract. It does not go red. The next step removes the extra copies.

- [ ] **Step 3: Read the name from the shop record**

In `lib/wix/invoiceRules.ts`, add the import next to the existing import and replace the constant:

```ts
import { TORONTO_SHOP } from "@/lib/shop/toronto";
import { validateVinForModelYear, VIN_CHARSET, normalizeVin } from "@/lib/vin/validate";

export const LEGAL_ENTITY_NAME = TORONTO_SHOP.legalName;
```

In `lib/reports/weeklyShopReport.ts`, add:

```ts
import { TORONTO_SHOP } from "@/lib/shop/toronto";
```

In `renderWeeklyShopReport`, replace the text-line literal:

```ts
  const textLines: string[] = [
    TORONTO_SHOP.legalName,
```

Replace the HTML literal:

```ts
  <p><strong>${escapeHtml(TORONTO_SHOP.legalName)}</strong></p>
```

`escapeHtml` is already defined in this file. Do not change the report's hours, address, or recipient. This email is internal (`info@torontomoto.com`) and only the legal name was duplicated.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/shopIdentity.test.ts tests/unit/weeklyShopReport.test.ts tests/unit/wixInvoiceRules.test.ts`

Expected: PASS. `tests/unit/wixInvoiceRules.test.ts` still expects `businessName: "OTOMOTO TORONTO MOTO INC."`.

- [ ] **Step 5: Commit**

```bash
git add lib/wix/invoiceRules.ts lib/reports/weeklyShopReport.ts tests/unit/shopIdentity.test.ts tests/unit/weeklyShopReport.test.ts
git commit -m "Read the weekly report and invoice legal name from the Toronto shop record."
```

## Out of scope

Adobe App Builder does not help this shop. Staff already use the Next.js floor. `lib/shop/toronto.ts` already holds the address, phone, and hours. Square webhooks already verify HMAC and store an idempotency ledger. Parts Canada and Wix contact crons already skip a run that is in progress. The weekly report already dedupes by week. Do not scaffold `adobe/otomoto-floor`, a Spectrum UI, Runtime actions, or an `aio app deploy` workflow.

## Self-review

- Spec coverage: Task 1 adds the compare. Task 2 covers all six `!== \`Bearer`inbound routes found in`app/api`. Task 3 covers both legal-name literals in `lib/reports/weeklyShopReport.ts`and`LEGAL_ENTITY_NAME`in`lib/wix/invoiceRules.ts`.
- Outbound bearer headers stay untouched.
- `bearerAuthorizationMatches` has the same signature in Tasks 1 and 2.
- The identity test is expected to pass before the wiring, because the strings already match. The helper test is the one that fails first.
