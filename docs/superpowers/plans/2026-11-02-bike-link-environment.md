# Bike link environment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Toronto Moto bike-link path from a Triumph under the seat, through a window box on the building Wi-Fi, to a reading on the motorcycle page, without sending a customer text.

**Architecture:** The bike box measures and sleeps. A window box stamps the place and, once this plan's route exists, POSTs one JSON object. The shop app already interprets service, battery, and faults from a typed reading. This plan adds the box sticker, the ingest route, and the firmware contracts. It does not add a second reading format.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres, Vitest. Bike firmware targets Seeed XIAO nRF52840 (Arduino). Window firmware targets ESP32-S3-DevKitC-1 plus a Reyax RYLR998.

**Spec already written:** `docs/hardware/bike-link-environment.md`, `docs/hardware/bike-link-build.md`, `docs/hardware/bike-link-wiring.md`.

## How to use this on Claude, then bring it back

Paste this file as the only brief. Do not reopen the choices in **Global Constraints**. Implement tasks in order. Stop at the end of a task and commit. Do not start Task 4 until Tasks 1–3 pass `npm test` and `npm run typecheck`.

Bring the work back as commits on branch `cursor/bike-link-readings-0901`, or on a new branch named `cursor/<short-name>-0901` cut from that branch. Open or update pull request 76 against `main`. Do not merge. Do not deploy.

## Global Constraints

- Shop legal entity is OTOMOTO TORONTO MOTO INC., 99 River Street, Toronto, ON M5A 3P4. Phone 647-424-1088 stays in Wix. Do not send customer SMS. Do not add a Twilio customer-message path.
- Production ships from `main` only. Never run `vercel --prod` from a feature branch. Do not point `NEXT_PUBLIC_SUPABASE_URL` at project `eofxprepuajpqyvlolhw`. Local work uses the Docker Supabase stack.
- First bikes are Triumphs with the SAE J1962 16-pin socket. CAN H is pin 6. CAN L is pin 14. The plug does not power the box. Pin 16 is sense only when a meter shows it follows the key. Red 6-pin Triumphs and 2006–2012 K-line triples are out of this firmware.
- Power for the bike box is a 1 A fuse within 15 cm of battery positive, then a 1N5822, then a TPS7A1601 set near 3.7 V into the XIAO battery pads. Sleep pass mark is under 50 µA at the fuse, key off, USB unplugged, CAN power off.
- Radio is 915 MHz, `AT+CRFOP=0`, then `AT+MODE=1` after each bike transmission. Do not transmit at the module default of 22 dBm. One window box serves every bike in range. The bike does not join Wi-Fi.
- Readings use `parseBikeReading` in `lib/bikeLink/reading.ts`. Sources are exactly `shop_bay`, `home`, `partner`. Do not clear fault codes. Do not store odometer `0` for "could not read." A lower odometer than the previous stored reading is rejected.
- Staff who may record a reading are the roles accepted by `canUpdateServiceInformation` in `lib/permissions/checks.ts`: `owner`, `manager`, `service_advisor`.
- Checks before a commit: `npm test`, `npm run typecheck`.

---

## What is already in the repo

Do not rebuild these.

| Piece | Where |
| --- | --- |
| Reading parser, service and battery bands, client sentence | `lib/bikeLink/reading.ts` |
| Unit tests for that parser | `tests/unit/bikeLink.test.ts` |
| Insert a typed reading, save the interval | `lib/services/bikeLink.ts` functions `recordBikeReading`, `saveBikeLinkSchedule` |
| Forms on the motorcycle page | `components/motorcycles/BikeLinkPanel.tsx`, `app/(app)/motorcycles/bike-link-actions.ts` |
| Needs a call list | `components/motorcycles/BikeLinkAttention.tsx` on `app/(app)/motorcycles/page.tsx` |
| Tables `bike_link_schedule`, `bike_link_reading`, view `bike_link_latest_reading` | `supabase/migrations/20261102193000_bike_link_readings.sql`, `supabase/migrations/20261102194500_bike_link_latest_reading.sql` |
| Hardware build, Triumph pinout, window-box parts | `docs/hardware/bike-link-build.md`, `docs/hardware/bike-link-wiring.md` |
| Place plan and cost order | `docs/hardware/bike-link-environment.md` |

There is no `box_id` column, no ingest route, and no firmware.

Bearer-secret routes in this app follow `app/api/cron/weekly-shop-report/route.ts`: `Authorization: Bearer <secret>`, 500 when the env var is empty, 401 when the header does not match. Service-role clients are created only in `lib/database/supabase-admin.ts` and must not be imported by a client component.

Audit writes go through `addAuditLog` in `lib/audit/addAuditLog.ts`. `actor_user_id` may be null.

---

## Task 1: Pair a box sticker with one motorcycle

**Files:**
- Create: `supabase/migrations/20261102223000_bike_link_box.sql`
- Modify: `lib/services/bikeLink.ts`
- Modify: `app/(app)/motorcycles/bike-link-actions.ts`
- Modify: `components/motorcycles/BikeLinkPanel.tsx`
- Test: `tests/unit/bikeLinkBox.test.ts`

**Interfaces:**
- Consumes: `canUpdateServiceInformation`, `requireUser`, `createClient`, `addAuditLog`, `parseBikeReading` (unchanged).
- Produces: table `public.bike_link_box`. Service `assignBikeLinkBox(motorcycleId: string, boxId: string): Promise<void>`. Service `getBikeLink` gains `boxId: string | null` on `BikeLinkView`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseBoxId } from "@/lib/bikeLink/box";

describe("parseBoxId", () => {
  it("accepts the sticker shape", () => {
    expect(parseBoxId("TM-BL-0007")).toEqual({ ok: true, boxId: "TM-BL-0007" });
  });

  it("rejects a short id and a lower-case id", () => {
    expect(parseBoxId("TM-BL-7").ok).toBe(false);
    expect(parseBoxId("tm-bl-0007").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/bikeLinkBox.test.ts`
Expected: FAIL because `@/lib/bikeLink/box` does not exist.

- [ ] **Step 3: Add the parser and the migration**

`lib/bikeLink/box.ts`:

```ts
const BOX_ID = /^TM-BL-[0-9]{4}$/;

export function parseBoxId(
  raw: string
): { ok: true; boxId: string } | { ok: false; error: string } {
  const boxId = raw.trim();
  if (!BOX_ID.test(boxId)) {
    return { ok: false, error: "Box id looks like TM-BL-0007." };
  }
  return { ok: true, boxId };
}
```

`supabase/migrations/20261102223000_bike_link_box.sql`:

```sql
CREATE TABLE public.bike_link_box (
  box_id text PRIMARY KEY,
  motorcycle_id uuid NOT NULL UNIQUE
    REFERENCES public.motorcycle (motorcycle_id) ON DELETE CASCADE,
  paired_at timestamptz NOT NULL DEFAULT now(),
  paired_by_user_id uuid
    REFERENCES public.app_user (user_id) ON DELETE SET NULL,
  CONSTRAINT bike_link_box_id_shape
    CHECK (box_id ~ '^TM-BL-[0-9]{4}$')
);

COMMENT ON TABLE public.bike_link_box IS
  'Sticker on one bike box. One box, one motorcycle.';

ALTER TABLE public.bike_link_reading
  ADD COLUMN box_id text
    REFERENCES public.bike_link_box (box_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX bike_link_reading_box_recorded
  ON public.bike_link_reading (box_id, recorded_at)
  WHERE box_id IS NOT NULL;

ALTER TABLE public.bike_link_box ENABLE ROW LEVEL SECURITY;

CREATE POLICY bike_link_box_select ON public.bike_link_box
  FOR SELECT TO authenticated
  USING ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_box_insert ON public.bike_link_box
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_active_app_user()));

CREATE POLICY bike_link_box_update ON public.bike_link_box
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_active_app_user()))
  WITH CHECK ((SELECT public.is_active_app_user()));

GRANT SELECT, INSERT, UPDATE ON TABLE public.bike_link_box TO authenticated;
```

Apply locally with `supabase db reset` or `supabase migration up` against the Docker stack. Do not apply this migration to the production project from a feature branch.

- [ ] **Step 4: Pair from the motorcycle page**

`assignBikeLinkBox` checks `canUpdateServiceInformation`, runs `parseBoxId`, and writes audit action `bike_link.box_paired`. If the sticker is already on a different motorcycle, return the error `That box is already paired.` Do not delete the other bike's row to steal it. If this motorcycle already has a different sticker, delete that row and insert the new one in one transaction. `box_id` is the primary key, so do not try to update it in place.

Show the current sticker on `BikeLinkPanel` and a text field named `box_id` with a save button. Revalidate `/motorcycles/${motorcycleId}` after a successful save.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/unit/bikeLinkBox.test.ts tests/unit/bikeLink.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add lib/bikeLink/box.ts lib/services/bikeLink.ts app/(app)/motorcycles/bike-link-actions.ts components/motorcycles/BikeLinkPanel.tsx supabase/migrations/20261102223000_bike_link_box.sql tests/unit/bikeLinkBox.test.ts
git commit -m "Pair a bike-link sticker with one motorcycle."
```

---

## Task 2: Accept the window-box JSON with the existing parser

**Files:**
- Create: `lib/bikeLink/ingest.ts`
- Create: `lib/database/supabase-admin.ts` addition `createBikeLinkAdminClient`
- Create: `app/api/bike-link/readings/route.ts`
- Test: `tests/unit/bikeLinkIngest.test.ts`

**Interfaces:**
- Consumes: `parseBoxId`, `parseBikeReading`, table `bike_link_box`, table `bike_link_reading`.
- Produces: `ingestBikeLinkPacket(body: unknown, now: Date): Promise<IngestResult>` where `IngestResult` is `{ ok: true; readingId: string; duplicate: boolean } | { ok: false; status: 404 | 422; error: string }`.
- Route: `POST /api/bike-link/readings`. Header `Authorization: Bearer <BIKE_LINK_INGEST_SECRET>`. Body is the mailbox object below. `clockSet` is not a field on this route.

Mailbox body, already fixed by the build guide:

```json
{
  "boxId": "TM-BL-0007",
  "source": "home",
  "placeName": "",
  "odometer": "48210",
  "batteryVolts": "12.6",
  "faultCodes": "P0335 C14",
  "recordedAt": "2026-11-02T21:15:00Z"
}
```

`odometer`, `batteryVolts`, and `faultCodes` are strings. Empty string means not read. `recordedAt` may be UTC with `Z` or a shop-local `2026-11-02T16:15` with no zone. `parseBikeReading` already accepts both.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { packetToReadingInput } from "@/lib/bikeLink/ingest";

describe("packetToReadingInput", () => {
  it("maps the mailbox object onto parseBikeReading fields", () => {
    const input = packetToReadingInput({
      boxId: "TM-BL-0007",
      source: "shop_bay",
      placeName: "99 River Street",
      odometer: "",
      batteryVolts: "12.6",
      faultCodes: "",
      recordedAt: "2026-11-02T21:15:00Z",
    });
    expect(input).toEqual({
      ok: true,
      boxId: "TM-BL-0007",
      source: "shop_bay",
      placeName: "99 River Street",
      odometer: "",
      batteryVolts: "12.6",
      faultCodes: "",
      recordedAt: "2026-11-02T21:15:00Z",
    });
  });

  it("rejects a packet that is not an object", () => {
    expect(packetToReadingInput(null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/bikeLinkIngest.test.ts`
Expected: FAIL because `lib/bikeLink/ingest.ts` does not exist.

- [ ] **Step 3: Implement the mapper**

`packetToReadingInput` returns `{ ok: false, error: "Reading was not a JSON object." }` unless `body` is a non-null object. It reads only the seven keys above, each coerced with `String(value ?? "")`. It runs `parseBoxId` on `boxId` and returns that error when the sticker is wrong. It does not call the database.

`ingestBikeLinkPacket` is the database half, used by the route and covered by a service test only if a local Supabase client is already how other service tests run. If no service-level harness exists, keep the database half thin and test the route with a mocked admin client in `tests/unit/bikeLinkIngestRoute.test.ts`. Do not add a new test framework.

Database steps inside `ingestBikeLinkPacket`:

1. Map the body. On failure return `{ ok: false, status: 422, error }`.
2. Select `motorcycle_id` from `bike_link_box` where `box_id` matches. No row: `{ ok: false, status: 404, error: "Unknown box." }`.
3. Load the latest `odometer` for that motorcycle from `bike_link_reading` and pass it as `previousOdometer`.
4. Call `parseBikeReading`. On failure return `{ ok: false, status: 422, error: parsed.error }`.
5. Insert `bike_link_reading` with `box_id`, `recorded_by_user_id` null, and `recorded_at` set from `parsed.reading.recordedAt.toISOString()`.
6. Unique violation on `(box_id, recorded_at)`: select the existing `reading_id` and return `{ ok: true, readingId, duplicate: true }`.
7. Otherwise return `{ ok: true, readingId, duplicate: false }` and audit `bike_link.reading_received` with `actor_user_id: null`.

Use `createBikeLinkAdminClient()` from `lib/database/supabase-admin.ts`. Copy the existing `createServiceRoleClient` helper. The configuration error string is `BIKE_LINK_INGEST_MISCONFIGURED`.

- [ ] **Step 4: Add the route**

`app/api/bike-link/readings/route.ts`:

```ts
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.BIKE_LINK_INGEST_SECRET?.trim();
  if (!secret) {
    return Response.json({ ok: false, error: "BIKE_LINK_INGEST_SECRET is not configured" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Reading was not a JSON object." }, { status: 422 });
  }
  const result = await ingestBikeLinkPacket(body, new Date());
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: result.status });
  }
  return Response.json(
    { ok: true, readingId: result.readingId, duplicate: result.duplicate },
    { status: result.duplicate ? 200 : 201 }
  );
}
```

Do not log the bearer token. Do not accept the secret as a query parameter.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/unit/bikeLinkIngest.test.ts tests/unit/bikeLink.test.ts && npm run typecheck`
Expected: PASS.

```bash
git commit -m "Accept a bike-link reading posted by a window box."
```

Document `BIKE_LINK_INGEST_SECRET` in the environment example file this repo already uses for server secrets. Do not invent a secret value. Do not put the value in the firmware source.

---

## Task 3: Show a posted reading the same way as a typed one

**Files:**
- Modify: `lib/services/bikeLink.ts` only if `getBikeLink` and `listBikeLinkAttention` ignore `box_id`. They must keep using `bike_link_latest_reading` ordered by `recorded_at`.
- Modify: `supabase/migrations/20261102194500_bike_link_latest_reading.sql` only by a new migration that recreates the view if the column list is explicit and would break after `box_id` was added. Read the view first. `SELECT *` is not used; the view lists columns. If `box_id` is absent from the view, leave the view as it is. The panel does not need `box_id` on each reading.
- Test: `tests/unit/bikeLink.test.ts` already covers interpretation. Add one case only if a posted reading with an empty odometer string and a voltage still produces a report. That case belongs in `tests/unit/bikeLinkIngest.test.ts` by calling `parseBikeReading` on the mapped packet.

- [ ] **Step 1: Confirm the latest-reading view still compiles after Task 1**

Run the local migration. Query `bike_link_latest_reading` for a motorcycle that has one typed row and one posted row. The newer `recorded_at` wins. `Needs a call` uses that row.

- [ ] **Step 2: Commit only if a view or query had to change**

```bash
git commit -m "Keep the latest bike reading view valid after box ids."
```

---

## Task 4: Bike-box firmware contract

Do this after a person can pair `TM-BL-0007` on a motorcycle page. Firmware lives in `firmware/bike/`, new in this repo. The sketch is Arduino for Seeed XIAO nRF52840, SKU 102010448. Pin names are the wiring file, not a second pinout.

**Files:**
- Create: `firmware/bike/README.md` (build steps pointing at `docs/hardware/bike-link-wiring.md`, not a copy of it)
- Create: `firmware/bike/bike_link.ino`
- Create: `firmware/bike/packet.h` and `firmware/bike/packet.cpp` for the JSON text

**Behavior the sketch must implement:**

1. Sleep with CAN power off (XIAO D3 high so the AO3401A stays off), Bluetooth off, and radio off or unfitted. D6 and D7 stay inputs while the radio header is empty.
2. D2 low for a few seconds means key on. Wait for the ECU. Turn CAN on. Try 500 kbit/s, then 250 kbit/s. Request id `7DF`, ISO 15765-4. Read emission fault codes. Ask for the odometer only through a function named `readOdometer` that returns an empty string until a real Triumph in the shop has confirmed a request. Do not invent a PID. Do not send a clear-DTC command.
3. On key off, read once more immediately, then turn CAN off. Twenty minutes later, sample the divider on D0. Throw away a sample at or above 13.4 V. Store volts to one decimal or leave voltage empty.
4. A stored row needs at least one of odometer, volts, or a fault code. Reject a new odometer that is lower than the last odometer this box stored. Never store `0` for a failed read.
5. Until the phone has written the clock, keep the row and set `clockSet` false. Do not advertise that row to the radio task.
6. For a few minutes after a new row with `clockSet` true, advertise BLE name `TM-BL-` plus the four digits compiled into the sketch. One text characteristic is the JSON object. A second characteristic accepts a UTC clock set.
7. JSON keys and types match Task 2, except the bike omits `source` and `placeName`. Those two are the window box's job. Bike JSON:

```json
{
  "boxId": "TM-BL-0007",
  "odometer": "48210",
  "batteryVolts": "12.6",
  "faultCodes": "P0335 C14",
  "recordedAt": "2026-11-02T21:15:00Z",
  "clockSet": true
}
```

8. Empty unread fields are `""`. `faultCodes` is a space-separated list, at most 20 codes, each matching `parseBikeReading`'s code shape.
9. Once a day while parked, sample voltage without turning CAN on. Store when voltage moved by 0.1 V or seven days passed. Advertise briefly. Do not advertise all day.
10. Radio task is compiled out until `firmware/bike/radio.h` defines `BIKE_LINK_RADIO 1`. When enabled: UART on D6/D7 to the RYLR998, 3.3 V, `AT+CRFOP=0`, `AT+BAND=915000000`, packet under 240 bytes, then `AT+MODE=1`. Retry a few times after a ride, then once on the daily wake. Stop when the window echoes the same `recordedAt`.

- [ ] **Step 1: Add a host test that the C packet builder's contract is mirrored in TypeScript**

Create `firmware/bike/packet_contract.test.ts` (Vitest, imported from the unit config) that builds the bike JSON with a small function `bikePacket(row)` in `firmware/bike/packet_contract.ts` and asserts the keys, the empty-string rule, `JSON.stringify(packet).length <= 240`, and that `clockSet: false` is detectable by `readyForRadio(packet) === false`.

- [ ] **Step 2: Run it**

Run: `npx vitest run firmware/bike/packet_contract.test.ts`
Expected: PASS after the helper exists.

- [ ] **Step 3: Write the sketch to call the same field names**

The `.ino` file may be checked by reading it in `tests/unit/bikeFirmwareContract.test.ts`: the file contains `7DF`, does not contain a clear-DTC service (`0x04` as a transmitted service is easy to get wrong, so instead assert the sketch contains the comment `do not clear codes` and does not contain the string `ClearDTC`). Assert it contains `AT+CRFOP=0` only inside a block guarded by `BIKE_LINK_RADIO`.

- [ ] **Step 4: Bench steps, written into `firmware/bike/README.md`**

These are the pass marks, copied from the build guide. The README lists them in this order and adds no extra electrical steps.

1. Regulator about 3.7 V before the XIAO is connected.
2. Sleep current at the fuse under 50 µA.
3. 12.6 V on the bench appears in the BLE JSON within 0.1 V.
4. CAN terminator absent. Resistance between pins 6 and 14 on the bike unchanged after the sleeping box is plugged in.
5. The bike starts and idles with the cable connected.

- [ ] **Step 5: Commit**

```bash
git commit -m "Add the Triumph bike-box firmware contract."
```

---

## Task 5: Window-box firmware contract

One sketch for every place. The place is compile-time configuration, not a bike field.

**Files:**
- Create: `firmware/mailbox/mailbox.ino`
- Create: `firmware/mailbox/README.md`

**Configuration in the sketch, one box each:**

| Place | `source` | `placeName` |
| --- | --- | --- |
| 99 River Street window | `shop_bay` | `99 River Street` |
| Client home | `home` | empty string, or a short label |
| Cafe or storage | `partner` | the place name, 80 characters or fewer |

**Behavior:**

1. ESP32-S3 joins the building Wi-Fi from constants `WIFI_SSID` and `WIFI_PASSWORD` that are `#include`d from `firmware/mailbox/secrets.h`. Add `firmware/mailbox/secrets.h` to `.gitignore`. Commit `firmware/mailbox/secrets.example.h` with empty strings.
2. RYLR998 on the devkit 3.3 V pin and a UART, TX crossed to RX. Set `AT+CRFOP=0` and `AT+BAND=915000000` in `setup` before any send.
3. On a bike packet with `clockSet` true, add `source` and `placeName`, drop `clockSet`, and POST to `BIKE_LINK_URL` (the deployed origin plus `/api/bike-link/readings`) with `Authorization: Bearer` and `BIKE_LINK_INGEST_SECRET` from `secrets.h`.
4. HTTP 201 or 200: reply to the bike with the same `recordedAt` over the radio, then stop. HTTP 401: do not retry in a loop. Print the status on USB serial.
5. Until Task 2 is deployed, also print the POST body on USB serial so staff can type it in. Keep that print after the route exists.
6. No fuse and no sleep budget. The box is indoors, antenna side toward the bikes.

- [ ] **Step 1: Contract test**

`tests/unit/mailboxFirmwareContract.test.ts` reads `firmware/mailbox/mailbox.ino` and expects the strings `shop_bay`, `AT+CRFOP=0`, `/api/bike-link/readings`, and `secrets.h`. It expects `secrets.h` to be absent from git by reading `.gitignore`.

- [ ] **Step 2: Commit**

```bash
git commit -m "Add the window-box firmware contract."
```

---

## Task 6: Do not build these in the same pass

Claude stops here. A later plan can pick one of these up only after a real Triumph has produced a typed reading and the shop window has printed one packet.

- A Triumph odometer PID. `readOdometer` stays empty until a bike in the bay answers a named request.
- A 16-pin to red 6-pin adapter, and any K-line chip.
- Cellular, satellite, bike-to-bike relay, and a rooftop radio.
- Wi-Fi on the motorcycle.
- A customer text, a Wix send, or a change to the 647-424-1088 thread.
- An ingest route that clears codes or that writes a service-due flag of its own. Due and the client sentence stay inside `interpretBikeReading`.
- Production deploy, production Supabase migration, and a change of the GitHub default branch.

## Bring-back checklist

- [ ] Tasks 1–3 committed, `npm test` and `npm run typecheck` green.
- [ ] Tasks 4–5 committed only as firmware contracts and sketches. No secret file committed.
- [ ] Branch name matches `cursor/<short-name>-0901`.
- [ ] Pull request 76 updated, or a new PR into `main` that says it stacks on the bike-link work. Not merged. Not deployed.
- [ ] Hardware docs still say the plug is the Triumph 16-pin and the window box is shared. If a task contradicted `docs/hardware/bike-link-build.md`, the hardware doc wins and the task is wrong.
