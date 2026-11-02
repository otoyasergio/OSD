/**
 * Lists open Square invoices. Cancels them only with --confirm, and only
 * when the git branch is main. Paid invoices are not in the open list.
 * Run the dry-run, confirm the printed list, then cancel from main.
 */
import { execSync } from "node:child_process";

const confirm = process.argv.includes("--confirm");
const token = process.env.SQUARE_ACCESS_TOKEN?.trim() ?? "";
const locationId = process.env.SQUARE_LOCATION_ID?.trim() ?? "";
const environment = process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
const base =
  environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

if (!token || !locationId) {
  console.error("SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID are required.");
  process.exit(1);
}

const response = await fetch(`${base}/v2/invoices/search`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  },
  body: JSON.stringify({
    query: {
      filter: {
        location_ids: [locationId],
        statuses: ["DRAFT", "UNPAID", "SCHEDULED", "PARTIALLY_PAID"],
      },
    },
    limit: 200,
  }),
});
const body = await response.json();
if (!response.ok) {
  console.error("Square search failed", response.status);
  process.exit(1);
}

const invoices = body.invoices ?? [];
console.log(`Open Square invoices: ${invoices.length}`);
for (const invoice of invoices) {
  console.log(
    `${invoice.id}\t${invoice.status ?? ""}\t${invoice.invoice_number ?? ""}\tversion ${invoice.version ?? 0}`
  );
}

if (!confirm) {
  console.log("Dry-run only. Re-run with --confirm from main after this list is accepted.");
  process.exit(0);
}

const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
if (branch !== "main") {
  console.error(`Refusing to cancel from branch ${branch}. Check out main first.`);
  process.exit(1);
}
if (process.env.CONFIRM_CANCEL_OPEN_SQUARE_INVOICES !== "1") {
  console.error("Set CONFIRM_CANCEL_OPEN_SQUARE_INVOICES=1 to cancel this list.");
  process.exit(1);
}

for (const invoice of invoices) {
  const cancelled = await fetch(`${base}/v2/invoices/${invoice.id}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2024-12-18",
    },
    body: JSON.stringify({ version: invoice.version ?? 0 }),
  });
  console.log(`${invoice.id} cancel HTTP ${cancelled.status}`);
  if (!cancelled.ok) process.exit(1);
}
