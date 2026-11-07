import { unzipSync, strFromU8 } from "fflate";
import { getPartsCanadaConfig } from "@/lib/partsCanada/config";
import {
  parseInventoryCsv,
  type PartsCanadaCatalogRow,
} from "@/lib/partsCanada/parseInventory";

/** One extra download when Parts Canada answers with a server error. */
export const PARTS_CANADA_RETRY_DELAY_MS = 2_000;

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

async function fetchAuthorized(path: string): Promise<Response> {
  const { apiUrl, apiKey } = getPartsCanadaConfig();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "*/*",
    },
    cache: "no-store",
    // Large inventory ZIP; generous timeout but well inside the 300s cron cap.
    signal: AbortSignal.timeout(120_000),
  });
  return response;
}

/**
 * Parts Canada sometimes returns 500 while the nightly file is being built.
 * One retry stays inside the 10-request daily limit (the shop window makes
 * four scheduled calls).
 */
export async function responseAfterOneServerRetry(
  load: () => Promise<Response>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    })
): Promise<Response> {
  const first = await load();
  if (!RETRYABLE_STATUS.has(first.status)) return first;
  await first.body?.cancel().catch(() => undefined);
  await sleep(PARTS_CANADA_RETRY_DELAY_MS);
  return load();
}

function extractCsvFromZip(buffer: ArrayBuffer): string {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const csvEntry = Object.entries(unzipped).find(([name]) =>
    name.toLowerCase().endsWith(".csv")
  );
  if (!csvEntry) {
    throw new Error("PARTS_CANADA_INVENTORY_INVALID");
  }
  return strFromU8(csvEntry[1]!);
}

/**
 * Download the inventory ZIP from Parts Canada and parse CSV rows.
 * Rate limit: 10 requests / 24 hours. A server error is tried once more.
 */
export async function downloadInventoryCatalog(): Promise<PartsCanadaCatalogRow[]> {
  const response = await responseAfterOneServerRetry(() => fetchAuthorized("/inventory"));
  if (response.status === 403) throw new Error("PARTS_CANADA_FORBIDDEN");
  if (response.status === 404) throw new Error("PARTS_CANADA_INVENTORY_MISSING");
  if (response.status === 429) throw new Error("PARTS_CANADA_RATE_LIMITED");
  if (!response.ok) {
    throw new Error(`PARTS_CANADA_HTTP_${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const csv = extractCsvFromZip(buffer);
  return parseInventoryCsv(csv);
}
