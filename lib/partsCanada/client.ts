import { unzipSync, strFromU8 } from "fflate";
import { getPartsCanadaConfig } from "@/lib/partsCanada/config";
import {
  parseInventoryCsv,
  type PartsCanadaCatalogRow,
} from "@/lib/partsCanada/parseInventory";

async function fetchAuthorized(path: string): Promise<Response> {
  const { apiUrl, apiKey } = getPartsCanadaConfig();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "*/*",
    },
    cache: "no-store",
  });
  return response;
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
 * Download nightly inventory ZIP from Parts Canada and parse CSV rows.
 * Rate limit: 10 requests / 24 hours — call at most once per day.
 */
export async function downloadInventoryCatalog(): Promise<
  PartsCanadaCatalogRow[]
> {
  const response = await fetchAuthorized("/inventory");
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
