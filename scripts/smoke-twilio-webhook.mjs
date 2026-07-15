#!/usr/bin/env node
/**
 * Smoke: Twilio inbound webhook rejects unsigned requests (401).
 *
 * Usage:
 *   NEXT_PUBLIC_APP_URL=https://your-app.vercel.app node scripts/smoke-twilio-webhook.mjs
 *
 * Exit 0 on 401; non-zero otherwise.
 */
const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
if (!base) {
  console.error("Set NEXT_PUBLIC_APP_URL to the deployed origin.");
  process.exit(1);
}

const url = `${base}/api/twilio/webhooks`;
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "From=%2B14165550000&Body=smoke-test",
});

const body = await res.text();
if (res.status === 401) {
  console.log(`OK: unsigned POST ${url} → 401`);
  process.exit(0);
}

console.error(`FAIL: expected 401, got ${res.status}`);
console.error(body.slice(0, 500));
process.exit(1);
