# Twilio Messaging Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship dual SMS consent (transactional + marketing), public `/sms` opt-in, staff/portal consent UI, HELP/STOP auto-replies, consent audit log, and Wix/Twilio paste-pack docs so Toronto Moto can pass A2P / toll-free verification without freezing legacy transactional texts.

**Architecture:** Pure policy helpers decide send eligibility (soft rollout + marketing gate). A `smsConsent` service updates `customer` flags and appends `sms_consent_event` rows. Public `/sms`, staff `CustomerForm`, and portal preferences all call that service. Inbound webhook returns TwiML `<Message>` for HELP/STOP. Legal copy lives in docs for Wix; app links via env URLs.

**Tech Stack:** Next.js App Router, Supabase (migration + RLS), Vitest, existing Twilio webhook/send stack

**Spec:** `docs/superpowers/specs/2026-07-13-twilio-messaging-compliance-design.md`

---

## File map

| File                                                  | Responsibility                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `lib/sms/consentPolicy.ts`                            | Pure: can send transactional/marketing; keyword classification; reply copy         |
| `tests/unit/smsConsentPolicy.test.ts`                 | Policy + keyword unit tests                                                        |
| `supabase/migrations/038_sms_consent.sql`             | Customer consent columns + `sms_consent_event` + RLS                               |
| `lib/database/supabase.generated.ts`                  | Types for new columns/table                                                        |
| `lib/services/smsConsent.ts`                          | Apply consent changes + audit insert + welcome SMS                                 |
| `lib/services/communications.ts`                      | Enforce policy on send; inbound HELP/STOP/HALT + return reply body                 |
| `app/api/twilio/webhooks/route.ts`                    | Emit TwiML `<Message>` when handler returns reply                                  |
| `lib/services/errors.ts`                              | `SMS_MARKETING_NOT_CONSENTED` (and any soft-rollout messaging)                     |
| `lib/services/customers.ts`                           | Select/map new consent fields; accept consent on create/update                     |
| `app/(app)/customers/actions.ts`                      | Read consent checkboxes from FormData                                              |
| `components/forms/CustomerForm.tsx`                   | Dual unchecked SMS consent + disclosure                                            |
| `components/sms/SmsConsentFields.tsx`                 | Shared disclosure + two checkboxes (staff + portal + public)                       |
| `app/sms/page.tsx`                                    | Public standalone opt-in                                                           |
| `app/sms/actions.ts`                                  | Public subscribe server action (admin client)                                      |
| `lib/sms/legalUrls.ts`                                | Read `NEXT_PUBLIC_PRIVACY_POLICY_URL` / `NEXT_PUBLIC_TERMS_URL`                    |
| `components/portal/PortalSmsPrefs.tsx`                | Portal SMS preferences section                                                     |
| `app/c/[token]/actions.ts`                            | Portal consent update action                                                       |
| `lib/services/portal.ts`                              | Include consent fields on portal customer view                                     |
| `middleware.ts`                                       | Ensure `/sms` stays public (not in protected prefixes — already OK; document only) |
| `docs/compliance/privacy-policy-wix.md`               | Wix-ready Privacy draft + SMS clause                                               |
| `docs/compliance/sms-terms-wix.md`                    | Wix-ready SMS Terms                                                                |
| `docs/compliance/twilio-verification-paste-pack.md`   | Console paste pack                                                                 |
| `.env.local.example`                                  | New public legal URL vars                                                          |
| `docs/superpowers/acceptance/production-checklist.md` | Compliance publish steps                                                           |

---

### Task 1: Consent policy helpers (TDD)

**Files:**

- Create: `lib/sms/consentPolicy.ts`
- Create: `tests/unit/smsConsentPolicy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  canSendTransactionalSms,
  canSendMarketingSms,
  classifyInboundSmsKeyword,
  buildHelpReply,
  buildOptOutReply,
  buildOptInConfirmation,
  type SmsConsentSnapshot,
} from "@/lib/sms/consentPolicy";

const base: SmsConsentSnapshot = {
  sms_opted_out_at: null,
  sms_transactional_consent_at: null,
  sms_marketing_consent_at: null,
  sms_consent_source: null,
};

describe("canSendTransactionalSms", () => {
  it("blocks when opted out", () => {
    expect(
      canSendTransactionalSms({
        ...base,
        sms_opted_out_at: "2026-07-01T00:00:00Z",
      })
    ).toBe(false);
  });

  it("allows legacy when both consents null and never touched", () => {
    expect(canSendTransactionalSms(base)).toBe(true);
  });

  it("requires transactional flag after consent UI touch", () => {
    expect(canSendTransactionalSms({ ...base, sms_consent_source: "staff" })).toBe(false);
    expect(
      canSendTransactionalSms({
        ...base,
        sms_consent_source: "staff",
        sms_transactional_consent_at: "2026-07-01T00:00:00Z",
      })
    ).toBe(true);
  });
});

describe("canSendMarketingSms", () => {
  it("requires marketing consent and not opted out", () => {
    expect(canSendMarketingSms(base)).toBe(false);
    expect(
      canSendMarketingSms({
        ...base,
        sms_marketing_consent_at: "2026-07-01T00:00:00Z",
      })
    ).toBe(true);
    expect(
      canSendMarketingSms({
        ...base,
        sms_marketing_consent_at: "2026-07-01T00:00:00Z",
        sms_opted_out_at: "2026-07-02T00:00:00Z",
      })
    ).toBe(false);
  });
});

describe("classifyInboundSmsKeyword", () => {
  it("classifies STOP including HALT", () => {
    expect(classifyInboundSmsKeyword("stop")).toBe("opt_out");
    expect(classifyInboundSmsKeyword("HALT")).toBe("opt_out");
  });

  it("classifies HELP and START", () => {
    expect(classifyInboundSmsKeyword("HELP")).toBe("help");
    expect(classifyInboundSmsKeyword("START")).toBe("opt_in_clear");
  });

  it("returns other for free text", () => {
    expect(classifyInboundSmsKeyword("when ready?")).toBe("other");
  });
});

describe("reply copy", () => {
  it("builds HELP / STOP / welcome strings with Toronto Moto", () => {
    expect(buildHelpReply()).toContain("torontomoto.com");
    expect(buildHelpReply()).toContain("STOP");
    expect(buildOptOutReply()).toContain("unsubscribed");
    expect(buildOptInConfirmation(["transactional", "marketing"])).toContain("Welcome");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/smsConsentPolicy.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Implement `lib/sms/consentPolicy.ts`**

```ts
export type SmsConsentSnapshot = {
  sms_opted_out_at: string | null;
  sms_transactional_consent_at: string | null;
  sms_marketing_consent_at: string | null;
  sms_consent_source: string | null;
};

export type SmsProgram = "transactional" | "marketing";

export function canSendTransactionalSms(c: SmsConsentSnapshot): boolean {
  if (c.sms_opted_out_at) return false;
  const touched = c.sms_consent_source != null;
  if (!touched) return true;
  return c.sms_transactional_consent_at != null;
}

export function canSendMarketingSms(c: SmsConsentSnapshot): boolean {
  if (c.sms_opted_out_at) return false;
  return c.sms_marketing_consent_at != null;
}

const OPT_OUT = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "HALT",
]);
const OPT_IN_CLEAR = new Set(["START", "UNSTOP"]);
const HELP = new Set(["HELP", "INFO", "SUPPORT"]);

export type InboundKeywordKind = "opt_out" | "opt_in_clear" | "help" | "other";

export function classifyInboundSmsKeyword(body: string): InboundKeywordKind {
  const key = body.trim().toUpperCase();
  if (OPT_OUT.has(key)) return "opt_out";
  if (OPT_IN_CLEAR.has(key)) return "opt_in_clear";
  if (HELP.has(key)) return "help";
  return "other";
}

export function buildHelpReply(): string {
  return "Toronto Moto: For help visit torontomoto.com. Message frequency varies. Msg & data rates may apply. Reply STOP to cancel.";
}

export function buildOptOutReply(): string {
  return "Toronto Moto: You are unsubscribed. No more messages will be sent. Visit torontomoto.com for help.";
}

export function buildOptInConfirmation(programs: SmsProgram[]): string {
  const label =
    programs.includes("transactional") && programs.includes("marketing")
      ? "service updates and promotional offers"
      : programs.includes("marketing")
        ? "promotional offers"
        : "service updates";
  return `Toronto Moto: Welcome to our text alerts! You are enrolled for ${label}. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/smsConsentPolicy.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/sms/consentPolicy.ts tests/unit/smsConsentPolicy.test.ts
git commit -m "feat: add SMS consent policy helpers for soft rollout and keywords"
```

---

### Task 2: Database migration + types

**Files:**

- Create: `supabase/migrations/038_sms_consent.sql`
- Modify: `lib/database/supabase.generated.ts` (customer Row/Insert/Update + new table)

- [ ] **Step 1: Write migration**

```sql
-- Dual SMS consent + audit log for Twilio / CASL verification

ALTER TABLE customer
  ADD COLUMN IF NOT EXISTS sms_transactional_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_consent_source text;

COMMENT ON COLUMN customer.sms_transactional_consent_at IS
  'When set, customer opted in to transactional/service SMS.';
COMMENT ON COLUMN customer.sms_marketing_consent_at IS
  'When set, customer opted in to marketing/promotional SMS.';
COMMENT ON COLUMN customer.sms_consent_source IS
  'Last consent UI touch: web_form | staff | portal | inbound_sms. Non-null ends soft-rollout allow.';

CREATE TABLE IF NOT EXISTS sms_consent_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customer (customer_id) ON DELETE CASCADE,
  program text NOT NULL CHECK (program IN ('transactional', 'marketing', 'all')),
  action text NOT NULL CHECK (action IN ('opt_in', 'opt_out')),
  method text NOT NULL CHECK (method IN ('web_form', 'staff', 'portal', 'inbound_sms')),
  source_path text,
  actor_user_id uuid REFERENCES app_user (user_id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_consent_event_customer
  ON sms_consent_event (customer_id, created_at DESC);

ALTER TABLE sms_consent_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY sms_consent_event_select ON sms_consent_event
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sms_consent_event_insert ON sms_consent_event
  FOR INSERT TO authenticated
  WITH CHECK (true);
```

(If `app_user` PK column name differs, match existing FKs in prior migrations — use the same pattern as `communication_log.sent_by_user_id`.)

- [ ] **Step 2: Update generated types**

Either run `npm run db:types` against a linked project with the migration applied, **or** hand-edit `lib/database/supabase.generated.ts`:

- On `customer.Row` / `Insert` / `Update` add:
  - `sms_transactional_consent_at: string | null`
  - `sms_marketing_consent_at: string | null`
  - `sms_consent_source: string | null`
- Add `sms_consent_event` table definition mirroring the migration columns

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/038_sms_consent.sql lib/database/supabase.generated.ts
git commit -m "feat: add SMS consent columns and audit event table"
```

---

### Task 3: `smsConsent` service

**Files:**

- Create: `lib/services/smsConsent.ts`
- Create: `lib/sms/legalUrls.ts`
- Modify: `lib/services/errors.ts` (add `SMS_MARKETING_NOT_CONSENTED`, `SMS_TRANSACTIONAL_NOT_CONSENTED`)

- [ ] **Step 1: Add error messages**

In `lib/services/errors.ts` message map:

```ts
SMS_MARKETING_NOT_CONSENTED:
  "This customer has not opted in to marketing SMS.",
SMS_TRANSACTIONAL_NOT_CONSENTED:
  "This customer has not opted in to service SMS.",
```

- [ ] **Step 2: Implement legal URL helper**

```ts
// lib/sms/legalUrls.ts
export function getPrivacyPolicyUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim();
  return v || null;
}

export function getTermsUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_TERMS_URL?.trim();
  return v || null;
}
```

- [ ] **Step 3: Implement `applySmsConsent`**

```ts
// lib/services/smsConsent.ts — core shape
import { createAdminClient } from "@/lib/database/supabase-admin";
import { sendSms, isTwilioConfigured } from "@/lib/twilio/client";
import { normalizePhoneE164 } from "@/lib/twilio/phone";
import { buildOptInConfirmation, type SmsProgram } from "@/lib/sms/consentPolicy";

export type ConsentMethod = "web_form" | "staff" | "portal" | "inbound_sms";

export type ApplySmsConsentInput = {
  customerId: string;
  transactional: boolean;
  marketing: boolean;
  method: ConsentMethod;
  sourcePath?: string;
  actorUserId?: string | null;
  sendWelcome?: boolean;
  phoneForWelcome?: string | null;
};

/**
 * Sets sms_consent_source (ends soft rollout), updates consent timestamps,
 * writes audit rows for transitions, optionally sends welcome SMS.
 */
export async function applySmsConsent(input: ApplySmsConsentInput): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: existing, error } = await admin
    .from("customer")
    .select(
      "customer_id, phone, sms_transactional_consent_at, sms_marketing_consent_at, sms_opted_out_at"
    )
    .eq("customer_id", input.customerId)
    .single();
  if (error) throw error;

  const hadTxn = Boolean(existing.sms_transactional_consent_at);
  const hadMkt = Boolean(existing.sms_marketing_consent_at);
  const programsGained: SmsProgram[] = [];

  const patch = {
    sms_consent_source: input.method,
    sms_transactional_consent_at: input.transactional
      ? (existing.sms_transactional_consent_at ?? now)
      : null,
    sms_marketing_consent_at: input.marketing
      ? (existing.sms_marketing_consent_at ?? now)
      : null,
  };

  if (input.transactional && !hadTxn) programsGained.push("transactional");
  if (input.marketing && !hadMkt) programsGained.push("marketing");

  const { error: upErr } = await admin
    .from("customer")
    .update(patch)
    .eq("customer_id", input.customerId);
  if (upErr) throw upErr;

  const events: Array<{
    customer_id: string;
    program: "transactional" | "marketing";
    action: "opt_in" | "opt_out";
    method: ConsentMethod;
    source_path: string | null;
    actor_user_id: string | null;
  }> = [];

  if (input.transactional && !hadTxn) {
    events.push({
      customer_id: input.customerId,
      program: "transactional",
      action: "opt_in",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  } else if (!input.transactional && hadTxn) {
    events.push({
      customer_id: input.customerId,
      program: "transactional",
      action: "opt_out",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  }

  if (input.marketing && !hadMkt) {
    events.push({
      customer_id: input.customerId,
      program: "marketing",
      action: "opt_in",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  } else if (!input.marketing && hadMkt) {
    events.push({
      customer_id: input.customerId,
      program: "marketing",
      action: "opt_out",
      method: input.method,
      source_path: input.sourcePath ?? null,
      actor_user_id: input.actorUserId ?? null,
    });
  }

  // Always record a touch when saving from consent UI with no program transition
  // so soft-rollout ends even if both boxes unchecked.
  if (events.length === 0) {
    // No program transition — source already updated on customer; optional no-op
  } else {
    const { error: evErr } = await admin.from("sms_consent_event").insert(events);
    if (evErr) throw evErr;
  }

  if (
    input.sendWelcome &&
    programsGained.length > 0 &&
    isTwilioConfigured() &&
    !existing.sms_opted_out_at
  ) {
    const phone = normalizePhoneE164(input.phoneForWelcome ?? existing.phone ?? "");
    if (phone) {
      await sendSms({
        to: phone,
        body: buildOptInConfirmation(programsGained),
      });
    }
  }
}
```

Refine edge cases in implementation: when both boxes unchecked on first staff save, still set `sms_consent_source` (already in patch) so soft rollout ends — matches spec.

- [ ] **Step 4: Commit**

```bash
git add lib/services/smsConsent.ts lib/sms/legalUrls.ts lib/services/errors.ts
git commit -m "feat: add smsConsent service and legal URL helpers"
```

---

### Task 4: Enforce consent on outbound SMS + inbound TwiML replies

**Files:**

- Modify: `lib/services/communications.ts`
- Modify: `app/api/twilio/webhooks/route.ts`
- Create: `tests/unit/smsInboundKeywords.test.ts` (test classify + reply; optionally extract TwiML builder)

- [ ] **Step 1: Add TwiML helper test + tiny helper**

```ts
// lib/twilio/twiml.ts
export function twimlMessageResponse(message?: string | null): string {
  if (!message) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
```

Test escaping in `tests/unit/smsInboundKeywords.test.ts`.

- [ ] **Step 2: Update `sendWorkOrderMessage`**

When channel is `sms`, after loading customer (select must include consent columns):

```ts
import { canSendTransactionalSms, canSendMarketingSms } from "@/lib/sms/consentPolicy";

// existing templates are transactional:
if (!canSendTransactionalSms(customer)) {
  throw new Error(
    customer.sms_opted_out_at ? "SMS_OPTED_OUT" : "SMS_TRANSACTIONAL_NOT_CONSENTED"
  );
}
```

Keep using `SMS_OPTED_OUT` when opted out for existing UI copy.

If/when a marketing template is added later, gate with `canSendMarketingSms`. For this task, add a stub template key `marketing_promo` that uses marketing gate (or skip template and only document samples in paste pack — **prefer:** no new send UI yet; only enforce transactional policy on existing templates).

- [ ] **Step 3: Change `handleInboundSms` to return `Promise<string | null>`**

Replace local OPT_OUT/OPT_IN sets with `classifyInboundSmsKeyword`. On `opt_out`: set `sms_opted_out_at`, insert `sms_consent_event` (`program: all`, `action: opt_out`, `method: inbound_sms`), return `buildOptOutReply()`. On `help`: return `buildHelpReply()`. On `opt_in_clear`: clear `sms_opted_out_at` only; return null (or short ack — spec says clear only; **return null**). Keep YES/NO approval logic for `other`.

- [ ] **Step 4: Webhook uses TwiML helper**

```ts
const reply = await handleInboundSms({ from, body });
return new NextResponse(twimlMessageResponse(reply), {
  headers: { "Content-Type": "text/xml" },
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/unit/smsConsentPolicy.test.ts tests/unit/smsInboundKeywords.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/twilio/twiml.ts lib/services/communications.ts app/api/twilio/webhooks/route.ts tests/unit/smsInboundKeywords.test.ts
git commit -m "feat: enforce SMS consent on send and reply HELP/STOP via TwiML"
```

---

### Task 5: Shared `SmsConsentFields` + public `/sms`

**Files:**

- Create: `components/sms/SmsConsentFields.tsx`
- Create: `app/sms/page.tsx`
- Create: `app/sms/actions.ts`
- Create: `tests/unit/smsSubscribeValidation.test.ts` (pure validate helper)

- [ ] **Step 1: Validation helper (TDD)**

```ts
// lib/sms/subscribeValidation.ts
export function validateSmsSubscribeInput(input: {
  phone: string;
  transactional: boolean;
  marketing: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!input.phone.trim()) return { ok: false, error: "Phone is required." };
  if (!input.transactional && !input.marketing) {
    return { ok: false, error: "Choose at least one message type." };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Shared fields component**

Client or server-friendly checkboxes (unchecked by default), disclosure paragraph with Privacy/Terms links from `getPrivacyPolicyUrl()` / `getTermsUrl()` (pass URLs as props from server pages). Names: `sms_transactional`, `sms_marketing` (value `on` when checked).

Disclosure text (verbatim intent):

> By checking a box, you consent to receive recurring [service updates / promotional offers] text messages from Toronto Moto at the mobile number provided. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to opt out. Read our Privacy Policy and Terms.

- [ ] **Step 3: Public page + action**

`app/sms/page.tsx` — public layout matching shop branding lightly (Toronto Moto heading), phone input, `SmsConsentFields`, submit.

`app/sms/actions.ts`:

1. Validate with `validateSmsSubscribeInput` + `normalizePhoneE164`
2. Admin: find customer by phone digits match OR create minimal customer (`first_name`/`last_name` from optional fields or "SMS" / "Subscriber")
3. `applySmsConsent({ method: "web_form", sourcePath: "/sms", sendWelcome: true, transactional, marketing })`
4. Return success state

Do **not** add `/sms` to `PROTECTED_PREFIXES` (already public).

- [ ] **Step 4: Manual check**

Run: `npm run dev` → open `http://localhost:3000/sms` — boxes unchecked; submit without checkbox fails; with service box succeeds when Twilio/env available (or consent rows written even if welcome send fails — prefer catch welcome errors so consent still saves).

- [ ] **Step 5: Commit**

```bash
git add components/sms/SmsConsentFields.tsx app/sms/page.tsx app/sms/actions.ts lib/sms/subscribeValidation.ts tests/unit/smsSubscribeValidation.test.ts
git commit -m "feat: add public /sms opt-in page with dual consent"
```

---

### Task 6: Staff CustomerForm consent

**Files:**

- Modify: `components/forms/CustomerForm.tsx`
- Modify: `app/(app)/customers/actions.ts`
- Modify: `lib/services/customers.ts` (`Customer` type + `CUSTOMER_COLUMNS` + after create/update call consent)

- [ ] **Step 1: Extend form**

Below phone field, render `SmsConsentFields` with `defaultTransactional={Boolean(customer?.sms_transactional_consent_at)}` etc. Consent must not be required to save customer.

- [ ] **Step 2: Wire actions**

In `readCustomerInput` or separately:

```ts
sms_transactional: formData.get("sms_transactional") === "on",
sms_marketing: formData.get("sms_marketing") === "on",
consentTouched: true, // form always includes the fields when Task 6 ships
```

After successful `createCustomer` / `updateCustomer`, call `applySmsConsent` with `method: "staff"`, `actorUserId`, `sourcePath: "staff:customer_form"`, `sendWelcome: true` only when newly gaining a program.

Always call `applySmsConsent` on create/update when the new form is used so `sms_consent_source` is set (soft rollout ends for that customer).

- [ ] **Step 3: Extend Customer type + selects**

Add consent fields to `Customer` and `CUSTOMER_COLUMNS`.

- [ ] **Step 4: Commit**

```bash
git add components/forms/CustomerForm.tsx app/(app)/customers/actions.ts lib/services/customers.ts
git commit -m "feat: capture SMS consent on staff customer create/edit"
```

---

### Task 7: Portal SMS preferences

**Files:**

- Modify: `lib/services/portal.ts` (include consent fields on `view.customer`)
- Create: `components/portal/PortalSmsPrefs.tsx`
- Modify: `components/portal/PortalClient.tsx`
- Modify: `app/c/[token]/actions.ts`

- [ ] **Step 1: Portal action**

`portalUpdateSmsConsentAction(token, formData)` — resolve customer from portal token (same auth pattern as other portal actions), then `applySmsConsent({ method: "portal", sourcePath: `/c/${token}`, sendWelcome: true })`.

- [ ] **Step 2: UI section**

Optional card on portal: “Text message preferences” with `SmsConsentFields` + save button. Not required to use portal.

- [ ] **Step 3: Commit**

```bash
git add lib/services/portal.ts components/portal/PortalSmsPrefs.tsx components/portal/PortalClient.tsx app/c/[token]/actions.ts
git commit -m "feat: add SMS consent preferences on customer portal"
```

---

### Task 8: Compliance docs + env + checklist

**Files:**

- Create: `docs/compliance/privacy-policy-wix.md`
- Create: `docs/compliance/sms-terms-wix.md`
- Create: `docs/compliance/twilio-verification-paste-pack.md`
- Modify: `.env.local.example`
- Modify: `docs/superpowers/acceptance/production-checklist.md`

- [ ] **Step 1: Privacy draft**

Include business identity (Otomoto Toronto Moto Inc. / Toronto Moto), data categories, and **verbatim**:

`All the above categories exclude text messaging originator opt-in data and consent; this information won’t be shared with any third parties.`

- [ ] **Step 2: SMS Terms draft**

Program name, message types (service + optional marketing), frequency varies, message and data rates may apply, HELP/STOP, carrier liability, support via torontomoto.com, links to Privacy.

- [ ] **Step 3: Twilio paste pack**

Use cases: CUSTOMER_CARE, ACCOUNT_NOTIFICATIONS, MARKETING; opt-in URL `https://service.torontomoto.com/sms`; sample messages from spec; HELP/STOP/welcome copy; Additional Details note on soft rollout for legacy customers; monthly volume suggestion `1,000` (adjustable).

- [ ] **Step 4: Env example**

```bash
NEXT_PUBLIC_PRIVACY_POLICY_URL=https://www.torontomoto.com/privacy-policy
NEXT_PUBLIC_TERMS_URL=https://www.torontomoto.com/terms
```

- [ ] **Step 5: Checklist**

Add steps: publish Wix legal pages → set env → verify `/sms` live → submit campaign using paste pack → Advanced Opt-Out enabled.

- [ ] **Step 6: Commit**

```bash
git add docs/compliance .env.local.example docs/superpowers/acceptance/production-checklist.md
git commit -m "docs: add SMS compliance Wix drafts and Twilio verification paste pack"
```

---

### Task 9: Final verification

- [ ] **Step 1: Unit suite**

Run: `npm test -- tests/unit/smsConsentPolicy.test.ts tests/unit/smsSubscribeValidation.test.ts tests/unit/smsInboundKeywords.test.ts`

Expected: PASS

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: PASS

- [ ] **Step 3: Smoke checklist (manual)**

1. `/sms` — unchecked boxes; Privacy/Terms links (or hidden if env empty)
2. Staff customer edit — save with service SMS checked → flags + event row
3. Send work-order SMS to legacy customer (null source) → still works
4. Send to touched customer without transactional consent → blocked with clear error
5. Inbound HELP/STOP (smoke script or Twilio console) → TwiML body present

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address SMS compliance verification gaps"
```

(Only if fixes needed; otherwise skip empty commit.)

---

## Spec coverage checklist

| Spec requirement                           | Task          |
| ------------------------------------------ | ------------- |
| Dual consent flags + soft rollout          | 1, 2, 3, 4    |
| `sms_consent_event` audit                  | 2, 3          |
| Public `/sms` standalone layout A          | 5             |
| Staff form checkboxes                      | 6             |
| Portal preferences                         | 7             |
| HELP/STOP/HALT + welcome                   | 1, 3, 4       |
| START clears opt-out only                  | 4             |
| Wix Privacy/Terms drafts                   | 8             |
| Twilio paste pack                          | 8             |
| Env legal URLs                             | 5, 8          |
| Marketing separate from transactional      | 1, 3, 4       |
| Out of scope: Wix edit, Console buy number | 8 (docs only) |

---

## Self-review notes

- No TBD placeholders; function names consistent (`applySmsConsent`, `canSendTransactionalSms`, `classifyInboundSmsKeyword`).
- Marketing blast UI intentionally omitted; paste-pack samples still cover MARKETING use case.
- Public `/sms` customer create: implementers must use admin client and match existing phone normalization.
