#!/usr/bin/env node
/**
 * Doctor: report whether Twilio is configured correctly for this app.
 *
 * The app uses Twilio for Video and Voice:
 *   Video  ACCOUNT_SID + API_KEY_SID + API_KEY_SECRET
 *   Voice  the Video three + TWIML_APP_SID + AUTH_TOKEN for webhook signatures
 *
 * With credentials present it also checks the Twilio account itself — that the
 * TwiML app exists, and Voice webhook URLs point back at this deployment
 * rather than at localhost or an old preview.
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
// ------------------------------------------------------------------ subsystems

heading("Subsystems this enables");

const videoReady = Boolean(accountSid && apiKeySid && apiKeySecret);
const voiceReady = videoReady && Boolean(twimlAppSid);

// Voice webhooks are signature-verified with the Auth Token specifically;
// an API key cannot do it, so this stays a hard requirement.
if (authToken) pass("Voice webhooks — Auth Token available for signature checks");
else {
  fail("Voice webhooks — TWILIO_AUTH_TOKEN missing, so /api/twilio/voice/* returns 503");
}

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
  warn("NEXT_PUBLIC_APP_URL is unset — Voice webhook URL verification will be skipped");
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

// Numbers owned, and where their Voice webhooks point.
const numbers = await api(`${v2010}/IncomingPhoneNumbers.json?PageSize=50`);
if (!numbers.ok) {
  fail(
    `could not list phone numbers (${numbers.status}): ${numbers.body.message ?? "unknown error"}`
  );
} else {
  const list = numbers.body.incoming_phone_numbers ?? [];
  if (list.length === 0) {
    fail("the account owns no phone numbers — buy one before Voice can work");
  } else {
    pass(`${list.length} phone number${list.length === 1 ? "" : "s"} owned`);
    for (const n of list) {
      console.log(`\n  ${n.phone_number} (${n.friendly_name})`);
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
