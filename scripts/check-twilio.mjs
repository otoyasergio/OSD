#!/usr/bin/env node
/**
 * Doctor: report whether Twilio is configured correctly for this app.
 *
 * The app uses Twilio for three independent things, each needing different
 * credentials, so "Twilio works" is never a single yes/no:
 *   SMS    ACCOUNT_SID + AUTH_TOKEN + (MESSAGING_SERVICE_SID | FROM_NUMBER)
 *   Video  ACCOUNT_SID + API_KEY_SID + API_KEY_SECRET
 *   Voice  the Video three + TWIML_APP_SID
 *
 * With credentials present it also checks the Twilio account itself — that the
 * sender is owned, the TwiML app exists, and the webhook URLs on each number
 * point back at this deployment rather than at localhost or an old preview.
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-twilio.mjs
 *   NEXT_PUBLIC_APP_URL=https://service.torontomoto.com node scripts/check-twilio.mjs
 *
 * Exit 0 when every configured subsystem checks out, 1 otherwise.
 */

const env = (name) => process.env[name]?.trim() ?? "";

const accountSid = env("TWILIO_ACCOUNT_SID");
const authToken = env("TWILIO_AUTH_TOKEN");
const fromNumber = env("TWILIO_FROM_NUMBER");
const messagingServiceSid = env("TWILIO_MESSAGING_SERVICE_SID");
const apiKeySid = env("TWILIO_API_KEY_SID");
const apiKeySecret = env("TWILIO_API_KEY_SECRET");
const twimlAppSid = env("TWILIO_TWIML_APP_SID");
const appUrl = env("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");

let failures = 0;
let warnings = 0;

const pass = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const warn = (msg) => {
  warnings += 1;
  console.log(`  warn  ${msg}`);
};
const skip = (msg) => console.log(`  --    ${msg}`);

/** Show enough of a SID to identify it without pasting it somewhere public. */
const mask = (sid) => (sid.length > 10 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid);

function heading(text) {
  console.log(`\n${text}`);
}

// ---------------------------------------------------------------- credentials

heading("Credentials present");

if (accountSid) {
  if (/^AC[0-9a-f]{32}$/.test(accountSid)) pass(`TWILIO_ACCOUNT_SID ${mask(accountSid)}`);
  else
    fail(`TWILIO_ACCOUNT_SID is malformed (expected AC + 32 hex): ${mask(accountSid)}`);
} else {
  fail("TWILIO_ACCOUNT_SID is missing — nothing can work without it");
}

if (apiKeySid && !/^SK[0-9a-f]{32}$/.test(apiKeySid)) {
  fail(`TWILIO_API_KEY_SID is malformed (expected SK + 32 hex): ${mask(apiKeySid)}`);
}
if (twimlAppSid && !/^AP[0-9a-f]{32}$/.test(twimlAppSid)) {
  fail(`TWILIO_TWIML_APP_SID is malformed (expected AP + 32 hex): ${mask(twimlAppSid)}`);
}
if (messagingServiceSid && !/^MG[0-9a-f]{32}$/.test(messagingServiceSid)) {
  fail(
    `TWILIO_MESSAGING_SERVICE_SID is malformed (expected MG + 32 hex): ${mask(messagingServiceSid)}`
  );
}
if (fromNumber && !/^\+[1-9]\d{1,14}$/.test(fromNumber)) {
  fail(`TWILIO_FROM_NUMBER must be E.164 (e.g. +14165551234), got ${fromNumber}`);
}

// ------------------------------------------------------------------ subsystems

heading("Subsystems this enables");

const smsReady = Boolean(accountSid && authToken && (messagingServiceSid || fromNumber));
const videoReady = Boolean(accountSid && apiKeySid && apiKeySecret);
const voiceReady = videoReady && Boolean(twimlAppSid);

if (smsReady) {
  pass(`SMS — sending via ${messagingServiceSid ? "Messaging Service" : "From number"}`);
} else {
  const missing = [
    !accountSid && "TWILIO_ACCOUNT_SID",
    !authToken && "TWILIO_AUTH_TOKEN",
    !messagingServiceSid &&
      !fromNumber &&
      "TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER",
  ].filter(Boolean);
  fail(`SMS — not configured; missing ${missing.join(", ")}`);
}

// Inbound webhooks are signature-verified with the Auth Token specifically;
// an API key cannot do it, so this stays a hard requirement.
if (authToken)
  pass("Inbound SMS + status webhooks — Auth Token available for signature checks");
else
  fail(
    "Inbound SMS + status webhooks — TWILIO_AUTH_TOKEN missing, so /api/twilio/* returns 503"
  );

if (videoReady) pass("Messenger video calls — API key present");
else
  fail(
    `Messenger video calls — missing ${[!apiKeySid && "TWILIO_API_KEY_SID", !apiKeySecret && "TWILIO_API_KEY_SECRET"].filter(Boolean).join(", ") || "credentials"}`
  );

if (voiceReady) pass("Shop phone / staff voice — TwiML app configured");
else if (videoReady) fail("Shop phone / staff voice — TWILIO_TWIML_APP_SID missing");
else skip("Shop phone / staff voice — blocked on the video credentials above");

if (appUrl) {
  if (appUrl.startsWith("https://")) pass(`NEXT_PUBLIC_APP_URL ${appUrl}`);
  else warn(`NEXT_PUBLIC_APP_URL is not https (${appUrl}); Twilio will not call it`);
} else {
  warn(
    "NEXT_PUBLIC_APP_URL is unset — status callbacks and portal links will be skipped"
  );
}

// --------------------------------------------------------------- live account

// Prefer the API key for REST calls; fall back to the Auth Token. Note that
// Standard API keys are rejected by /Accounts and /Keys (error 20003), so the
// account lookup below is attempted only with the Auth Token.
const restAuth =
  apiKeySid && apiKeySecret
    ? `${apiKeySid}:${apiKeySecret}`
    : accountSid && authToken
      ? `${accountSid}:${authToken}`
      : "";

if (!restAuth || !accountSid) {
  heading("Twilio account");
  skip("no usable credentials, so the account itself was not inspected");
  report();
}

heading("Twilio account");

async function api(url, credentials = restAuth) {
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(credentials).toString("base64")}` },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, body };
}

const v2010 = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;

if (authToken) {
  // Must use the Auth Token: /Accounts rejects Standard API keys with 20003.
  const acct = await api(`${v2010}.json`, `${accountSid}:${authToken}`);
  if (acct.ok) {
    pass(`reachable: "${acct.body.friendly_name}" (status ${acct.body.status})`);
    if (acct.body.status !== "active")
      fail(`account status is ${acct.body.status}, not active`);
    if (acct.body.type === "Trial") {
      warn(
        "this is a Trial account — it can only message verified numbers and prepends a trial notice"
      );
    }
  } else {
    fail(
      `credentials rejected (${acct.status}): ${acct.body.message ?? "unknown error"}`
    );
    report();
  }
} else {
  skip("account lookup needs the Auth Token (Standard API keys cannot read /Accounts)");
}

// Numbers owned, and where their webhooks point.
const numbers = await api(`${v2010}/IncomingPhoneNumbers.json?PageSize=50`);
if (!numbers.ok) {
  fail(
    `could not list phone numbers (${numbers.status}): ${numbers.body.message ?? "unknown error"}`
  );
} else {
  const list = numbers.body.incoming_phone_numbers ?? [];
  if (list.length === 0) {
    fail("the account owns no phone numbers — buy one before SMS or voice can work");
  } else {
    pass(`${list.length} phone number${list.length === 1 ? "" : "s"} owned`);
    const expectedSms = appUrl ? `${appUrl}/api/twilio/webhooks` : "";
    for (const n of list) {
      console.log(`\n  ${n.phone_number} (${n.friendly_name})`);
      if (expectedSms) {
        if (n.sms_url === expectedSms) pass(`SMS webhook → ${n.sms_url}`);
        else if (!n.sms_url) fail(`SMS webhook is empty; set it to ${expectedSms}`);
        else fail(`SMS webhook is ${n.sms_url}; expected ${expectedSms}`);
      } else {
        skip(
          `SMS webhook is ${n.sms_url || "(empty)"} — set NEXT_PUBLIC_APP_URL to verify it`
        );
      }
      if (voiceReady) {
        // Inbound PSTN calls go to the number's own Voice URL. The TwiML app is
        // a separate path, used only for calls placed from the browser SDK, and
        // Twilio clears voice_url the moment voice_application_sid is set.
        const expectedVoice = appUrl ? `${appUrl}/api/twilio/voice/inbound` : "";
        const hint = expectedVoice || "…/api/twilio/voice/inbound";
        if (n.voice_application_sid) {
          fail(
            `voice is routed to TwiML app ${mask(n.voice_application_sid)}; inbound calls need the Voice URL ${hint} instead`
          );
        } else if (!n.voice_url) {
          fail(`voice is not routed anywhere; set the Voice URL to ${hint}`);
        } else if (expectedVoice && n.voice_url !== expectedVoice) {
          fail(`voice webhook is ${n.voice_url}; expected ${expectedVoice}`);
        } else {
          pass(`voice webhook → ${n.voice_url}`);
        }
      }
    }
    console.log("");

    if (fromNumber && !list.some((n) => n.phone_number === fromNumber)) {
      fail(`TWILIO_FROM_NUMBER ${fromNumber} is not owned by this account`);
    }
  }
}

// Messaging Service, if that is the chosen sender.
if (messagingServiceSid) {
  const svc = await api(
    `https://messaging.twilio.com/v1/Services/${messagingServiceSid}`
  );
  if (!svc.ok) {
    fail(`Messaging Service ${mask(messagingServiceSid)} not found (${svc.status})`);
  } else {
    pass(`Messaging Service "${svc.body.friendly_name}"`);
    const pool = await api(
      `https://messaging.twilio.com/v1/Services/${messagingServiceSid}/PhoneNumbers`
    );
    const count = pool.ok ? (pool.body.phone_numbers ?? []).length : 0;
    if (count === 0)
      fail("the Messaging Service has no senders in its pool, so sends will fail");
    else pass(`${count} sender${count === 1 ? "" : "s"} in the pool`);
  }
}

// TwiML app, if voice is configured.
if (twimlAppSid) {
  const app = await api(`${v2010}/Applications/${twimlAppSid}.json`);
  if (!app.ok) {
    fail(`TwiML app ${mask(twimlAppSid)} not found (${app.status})`);
  } else {
    pass(`TwiML app "${app.body.friendly_name}"`);
    const expectedVoice = appUrl ? `${appUrl}/api/twilio/voice/outbound` : "";
    if (!app.body.voice_url) fail("TwiML app has no Voice Request URL");
    else if (expectedVoice && app.body.voice_url !== expectedVoice) {
      fail(`TwiML app Voice URL is ${app.body.voice_url}; expected ${expectedVoice}`);
    } else pass(`Voice URL → ${app.body.voice_url}`);

    if (!app.body.status_callback)
      warn("TwiML app has no Status Callback URL, so call records may not close out");
  }
}

report();

function report() {
  console.log("");
  if (failures === 0 && warnings === 0) console.log("Twilio looks correctly configured.");
  else
    console.log(
      `${failures} problem${failures === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`
    );
  process.exit(failures > 0 ? 1 : 0);
}
