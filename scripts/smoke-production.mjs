#!/usr/bin/env node
/**
 * Production smoke checks for service.torontomoto.com
 * Usage: node scripts/smoke-production.mjs
 * Optional: BASE_URL=https://service.torontomoto.com CRON_SECRET=... node scripts/smoke-production.mjs
 */
const base = (process.env.BASE_URL ?? "https://service.torontomoto.com").replace(
  /\/$/,
  ""
);
const cronSecret = process.env.CRON_SECRET?.trim() ?? "";

const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`✗ ${name}: ${message}`);
  }
}

await check("health endpoint", async () => {
  const res = await fetch(`${base}/api/health`);
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(`status ${res.status} body=${JSON.stringify(body)}`);
  }
  if (body.integrations?.supabase !== "ok") {
    throw new Error(`supabase integration ${body.integrations?.supabase}`);
  }
});

await check("login page", async () => {
  const res = await fetch(`${base}/login`);
  if (!res.ok) throw new Error(`status ${res.status}`);
});

await check("cron rejects missing bearer (wix)", async () => {
  const res = await fetch(`${base}/api/cron/wix-contacts-sync`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

await check("cron rejects missing bearer (parts canada)", async () => {
  const res = await fetch(`${base}/api/cron/parts-canada-sync`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

await check("wix webhook fails closed without secret", async () => {
  const res = await fetch(`${base}/api/wix/webhooks/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contact: { id: "smoke" } }),
  });
  if (res.status !== 401 && res.status !== 503) {
    throw new Error(`expected 401/503, got ${res.status}`);
  }
});

if (cronSecret) {
  await check("cron auth accepts bearer (wix window skip ok)", async () => {
    const res = await fetch(`${base}/api/cron/wix-contacts-sync`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    const body = await res.json();
    if (!res.ok || !body.ok) {
      throw new Error(`status ${res.status} body=${JSON.stringify(body)}`);
    }
  });
} else {
  console.log("○ cron bearer check skipped (set CRON_SECRET to run)");
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nProduction smoke passed.");
