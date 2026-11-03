import type { AuctionLotRecord, BikeIdentity } from "@/lib/auctions/types";

const MAKE_ALIASES: Record<string, string> = {
  hd: "harley-davidson",
  "h-d": "harley-davidson",
  harley: "harley-davidson",
  "harley-davidson": "harley-davidson",
  "harley-davidson-motor-company": "harley-davidson",
  "bmw-motorrad": "bmw",
  canam: "can-am",
  "brp-can-am": "can-am",
};

/**
 * Family words that should not, by themselves, pull in every bike in that
 * family. They are dropped only when a more specific token remains.
 */
const GENERIC_FAMILY = new Set([
  "sportster",
  "softail",
  "touring",
  "dyna",
  "ninja",
  "motorcycle",
  "motorcycles",
  "motorbike",
  "bike",
  "bikes",
  "scooter",
  "scooters",
  "abs",
  "standard",
]);

export function makeKey(make: string): string {
  const key = make
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return MAKE_ALIASES[key] ?? key;
}

export function modelTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !/^(19|20)\d{2}$/.test(token));
}

export function requiredModelTokens(model: string, make: string): string[] {
  const makeTokens = new Set([...modelTokens(make), ...makeKey(make).split("-")]);
  const tokens = modelTokens(model).filter((token) => !makeTokens.has(token));
  const withoutFamily = tokens.filter((token) => !GENERIC_FAMILY.has(token));
  const hasDescriptive = withoutFamily.some((token) => !/^\d+$/.test(token));
  const chosen = hasDescriptive ? withoutFamily : tokens;
  return chosen.length > 0 ? chosen : tokens;
}

export function auctionSearchText(parts: {
  title: string;
  make: string;
  model: string;
}): string {
  return `${parts.title} ${parts.make} ${parts.model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function tokenHits(token: string, haystack: string[]): boolean {
  return haystack.some((candidate) => {
    if (candidate === token) return true;
    if (candidate.includes(token) && candidate.length <= token.length + 4) return true;
    if (
      token.includes(candidate) &&
      candidate.length >= 2 &&
      token.length <= candidate.length + 4
    ) {
      return true;
    }
    return false;
  });
}

/** Trim words that name a different variant. Condition words such as "miles" do not. */
const TRIM_WORDS = new Set([
  "special",
  "deluxe",
  "custom",
  "limited",
  "anniversary",
  "ultra",
  "elite",
  "premium",
  "sport",
  "classic",
]);

function conflictingTrim(required: string[], lotTokens: string[]): boolean {
  return lotTokens.some((token) => TRIM_WORDS.has(token) && !required.includes(token));
}

export function auctionLotMatchesBike(
  bike: BikeIdentity,
  lot: Pick<AuctionLotRecord, "make" | "model" | "title">
): boolean {
  if (!bike.make.trim() || !bike.model.trim() || !lot.make.trim()) return false;
  if (makeKey(bike.make) !== makeKey(lot.make)) return false;

  const required = requiredModelTokens(bike.model, bike.make);
  if (required.length === 0) return false;

  const haystack = modelTokens(`${lot.title} ${lot.model}`);
  if (!required.every((token) => tokenHits(token, haystack))) return false;

  const makeTokens = new Set([...modelTokens(lot.make), ...makeKey(lot.make).split("-")]);
  const lotTokens = haystack.filter((token) => !makeTokens.has(token));
  return !conflictingTrim(required, lotTokens);
}

/** Probe word for an ALT/FNDATA `like` filter. */
export function makeProbe(make: string): string | null {
  const word = makeKey(make)
    .split("-")
    .find((part) => part.length >= 3);
  return word ?? null;
}

/** Most specific model token to send as a contains-filter. */
export function modelProbe(model: string, make: string): string | null {
  const tokens = requiredModelTokens(model, make);
  if (tokens.length === 0) return null;
  return [...tokens].sort((a, b) => {
    const digitBias = Number(/\d/.test(b)) - Number(/\d/.test(a));
    if (digitBias !== 0) return digitBias;
    return b.length - a.length;
  })[0];
}
