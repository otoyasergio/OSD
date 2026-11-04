/**
 * Read-only gate check for Wix invoices.
 * Does not create a draft unless --probe-draft is passed.
 * A probe creates one draft and deletes it. If delete fails, that number is used.
 * Exits 0 only when every gate passes, including a draft display number.
 * The app stays off until WIX_INVOICES_ENABLED and WIX_INVOICES_GATES_CONFIRMED are both 1.
 */
import { readFileSync } from "node:fs";

const LEGAL_NAME = "OTOMOTO TORONTO MOTO INC.";
const probe = process.argv.includes("--probe-draft");

function fail(reasons) {
  console.error("Wix invoice gates are not clear. Leave the flag off.");
  for (const reason of reasons) console.error(`- ${reason}`);
  process.exit(1);
}

const apiKey = process.env.WIX_API_KEY?.trim() ?? "";
const siteId = process.env.WIX_SITE_ID?.trim() ?? "";
const squareToken = process.env.SQUARE_ACCESS_TOKEN?.trim() ?? "";
const squareLocation = process.env.SQUARE_LOCATION_ID?.trim() ?? "";
const squareEnv = process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";

if (!apiKey || !siteId) fail(["WIX_API_KEY and WIX_SITE_ID are required."]);

async function wix(path, init) {
  const response = await fetch(`https://www.wixapis.com${path}`, {
    ...init,
    headers: {
      Authorization: apiKey,
      "wix-site-id": siteId,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const reasons = [];
const latest = await wix("/invoices/v4/invoices/get-latest-number");
const latestNumber = latest.body?.number;
console.log(`latest invoice number: HTTP ${latest.status} value ${latestNumber ?? "missing"}`);
if (latest.status === 428) {
  reasons.push("Wix returned 428. The site is not on Get Paid Invoices.");
}
if (latest.status !== 200 || typeof latestNumber !== "number") {
  reasons.push("Could not read the latest invoice number.");
}

const site = await wix("/site-properties/v4/properties");
const properties = site.body?.properties ?? {};
const businessName = properties.businessName ?? "";
const country = properties.address?.country ?? "";
const subdivision = properties.address?.subdivision ?? properties.address?.state ?? "";
const currency = properties.paymentCurrency ?? "";
console.log(`business name: ${businessName || "missing"}`);
console.log(`address: ${country} ${subdivision} currency ${currency || "missing"}`);
if (businessName.trim() !== LEGAL_NAME) {
  reasons.push(`Site business name must be ${LEGAL_NAME}.`);
}
const ontario =
  ["CA", "CAN", "CANADA"].includes(String(country).toUpperCase()) &&
  ["ON", "ONTARIO"].includes(String(subdivision).toUpperCase());
if (!ontario || (currency && currency.toUpperCase() !== "CAD")) {
  reasons.push("Site properties must show an Ontario business so Wix adds 13% HST.");
}

const squareBase =
  squareEnv === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
let squareOk = false;
if (squareToken && squareLocation) {
  const square = await fetch(`${squareBase}/v2/locations/${squareLocation}`, {
    headers: {
      Authorization: `Bearer ${squareToken}`,
      "Square-Version": "2024-12-18",
    },
  });
  squareOk = square.ok;
  console.log(`square location: HTTP ${square.status}`);
}
if (!squareOk) reasons.push("Square location could not be read.");

const clientSource = readFileSync(new URL("../lib/square/client.ts", import.meta.url), "utf8");
if (!clientSource.includes('source_id: "EXTERNAL"')) {
  reasons.push("Square external payments are not implemented.");
}

if (!probe) {
  reasons.push(
    "Draft numbering has not been probed. Re-run with --probe-draft before the flag can turn on."
  );
} else {
  const contactId = process.env.WIX_GATE_PROBE_CONTACT_ID?.trim() ?? "";
  if (!contactId) {
    reasons.push("WIX_GATE_PROBE_CONTACT_ID is required for --probe-draft.");
  } else {
    const created = await wix("/invoices/v4/invoices", {
      method: "POST",
      body: JSON.stringify({
        invoice: {
          issueDate: new Date().toISOString(),
          currency: "CAD",
          title: "Gate probe",
          reference: { referenceType: "STANDALONE", standaloneReference: {} },
          customerInfo: { contactId },
          lineItems: [
            {
              lineItemType: "CUSTOM",
              customItem: { name: "Gate probe", quantity: "1", price: "0.00" },
            },
          ],
        },
      }),
    });
    const invoice = created.body?.invoice;
    const display = invoice?.numbering?.displayNumber ?? "";
    console.log(`probe draft: HTTP ${created.status} display ${display || "missing"}`);
    if (created.status === 428) {
      reasons.push("Create invoice returned 428. Turn the flag off.");
    } else if (created.status !== 200 && created.status !== 201) {
      reasons.push(`Create draft returned HTTP ${created.status}.`);
    }
    if (!display) reasons.push("The draft did not return numbering.displayNumber.");
    if (invoice?.id) {
      const deleted = await wix(`/invoices/v4/invoices/${invoice.id}`, { method: "DELETE" });
      console.log(`probe delete: HTTP ${deleted.status}`);
      if (deleted.status !== 200 && deleted.status !== 204) {
        reasons.push(
          `Probe draft ${display || invoice.id} was not deleted. That number is now used.`
        );
      }
    }
  }
}

if (reasons.length > 0) fail(reasons);
console.log("Gates passed. Set WIX_INVOICES_ENABLED=1 and WIX_INVOICES_GATES_CONFIRMED=1 on production only from main, after import and the Square dry-run.");
