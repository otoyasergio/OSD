import {
  fallbackUsdCadRateBook,
  mergeUsdCadRates,
  parseValetUsdCad,
  USD_CAD_DAILY_SERIES,
  USD_CAD_MONTHLY_SERIES,
  type UsdCadRateBook,
} from "@/lib/auctions/cad";

const VALET = "https://www.bankofcanada.ca/valet/observations";
const RATE_CACHE_MS = 12 * 60 * 60 * 1000;

let cached: { book: UsdCadRateBook; expiresAt: number } | null = null;

export function usdCadRateUrls(): { monthly: string; daily: string } {
  return {
    monthly: `${VALET}/${USD_CAD_MONTHLY_SERIES}/json?start_date=1999-01-01&end_date=2016-12-31`,
    daily: `${VALET}/${USD_CAD_DAILY_SERIES}/json?start_date=2017-01-01`,
  };
}

async function readSeries(response: Response, seriesName: string) {
  if (!response.ok) return [];
  return parseValetUsdCad(await response.json(), seriesName);
}

export async function loadUsdCadRateBook(options?: {
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<UsdCadRateBook> {
  const now = options?.now ?? Date.now();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const useCache = options?.fetchImpl == null;
  if (useCache && cached && cached.expiresAt > now) return cached.book;

  try {
    const urls = usdCadRateUrls();
    const init: RequestInit = { cache: "no-store", signal: AbortSignal.timeout(8000) };
    const [monthlyResponse, dailyResponse] = await Promise.all([
      fetchImpl(urls.monthly, init),
      fetchImpl(urls.daily, init),
    ]);
    const book = mergeUsdCadRates(
      await readSeries(monthlyResponse, USD_CAD_MONTHLY_SERIES),
      await readSeries(dailyResponse, USD_CAD_DAILY_SERIES)
    );
    if (book.source !== "bank-of-canada")
      throw new Error("Bank of Canada daily rates were empty");
    if (useCache) cached = { book, expiresAt: now + RATE_CACHE_MS };
    return book;
  } catch {
    if (useCache && cached) return cached.book;
    return fallbackUsdCadRateBook();
  }
}
