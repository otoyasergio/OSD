/**
 * Load motorcycle auction results into auction_lot.
 *
 * Accepts ALT/FNDATA JSON or CSV (the AWS Data Exchange motorcycle feed)
 * and a generic export with make, model, year, price_usd, sale_date.
 *
 * Refuses the production Supabase project unless IMPORT_AUCTION_LOTS_CONFIRM=1.
 *
 *   npm run import:auction-lots -- ./motorcycle-auctions.json
 *   npm run import:auction-lots -- ./iconic.csv --source iconic
 */
import { readFile } from "node:fs/promises";
import { recordsFromAuctionFile } from "@/lib/auctions/parseLots";
import { upsertAuctionLots } from "@/lib/services/auctionPriceGuide";

const PRODUCTION_REF = "eofxprepuajpqyvlolhw";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (url.includes(PRODUCTION_REF) && process.env.IMPORT_AUCTION_LOTS_CONFIRM !== "1") {
  console.error(
    "Refusing to import auction lots into the production database. Set IMPORT_AUCTION_LOTS_CONFIRM=1 to proceed."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const sourceFlag = args.indexOf("--source");
const source = sourceFlag >= 0 ? args[sourceFlag + 1] : "altfndata";
const filePath = args.find((arg) => !arg.startsWith("--") && arg !== source);

if (!filePath || !source) {
  console.error(
    "Usage: npm run import:auction-lots -- <file.json|file.csv> [--source altfndata]"
  );
  process.exit(1);
}

async function main() {
  const text = await readFile(filePath, "utf8");
  const lots = recordsFromAuctionFile(text, source);
  const imported = await upsertAuctionLots(lots);
  console.log(`Imported ${imported} auction lots from ${filePath} as ${source}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
