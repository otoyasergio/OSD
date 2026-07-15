export type AddressSuggestion = {
  label: string;
  postalCode: string;
};

type NrcanLocation = {
  title?: unknown;
  qualifier?: unknown;
  type?: unknown;
};

type GeoapifyResult = {
  formatted?: unknown;
  postcode?: unknown;
  result_type?: unknown;
};

const STREET_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bSt\.?\b/gi, "Street"],
  [/\bRd\.?\b/gi, "Road"],
  [/\bAve\.?\b/gi, "Avenue"],
  [/\bBlvd\.?\b/gi, "Boulevard"],
  [/\bDr\.?\b/gi, "Drive"],
  [/\bCres\.?\b/gi, "Crescent"],
  [/\bLn\.?\b/gi, "Lane"],
  [/\bHwy\.?\b/gi, "Highway"],
  [/\bN\.?\b/gi, "North"],
  [/\bS\.?\b/gi, "South"],
  [/\bE\.?\b/gi, "East"],
  [/\bW\.?\b/gi, "West"],
];

/** Bias short counter-intake searches to Toronto while allowing a typed city after a comma. */
export function buildAddressSearchTerm(query: string): string {
  let normalized = query.trim().replace(/\s+/g, " ");
  for (const [pattern, replacement] of STREET_ABBREVIATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.includes(",") ? normalized : `${normalized}, Toronto, ON`;
}

export function normalizeAddressSuggestions(raw: unknown): AddressSuggestion[] {
  if (!Array.isArray(raw)) return [];

  const ranked = raw
    .filter((item): item is NrcanLocation => Boolean(item && typeof item === "object"))
    .filter((item) => {
      const type = typeof item.type === "string" ? item.type : "";
      return type.endsWith(".Street") || type.endsWith(".Intersection");
    })
    .map((item, index) => {
      const label = typeof item.title === "string" ? item.title.trim() : "";
      const qualifier = typeof item.qualifier === "string" ? item.qualifier : "";
      const exact = qualifier === "INTERPOLATED_POSITION";
      const score =
        (exact ? 8 : 0) +
        (label.includes("City Of Toronto") ? 4 : 0) +
        (label.includes("Ontario") ? 2 : 0) -
        index / 100;
      return { label, score, exact };
    })
    .filter((item) => item.label)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const suggestions: AddressSuggestion[] = [];
  const hasExactAddress = ranked.some((item) => item.exact);
  for (const item of ranked) {
    if (hasExactAddress && !item.exact) continue;
    if (seen.has(item.label)) continue;
    seen.add(item.label);
    suggestions.push({ label: item.label, postalCode: "" });
    if (suggestions.length === 6) break;
  }
  return suggestions;
}

export function normalizeGeoapifySuggestions(raw: unknown): AddressSuggestion[] {
  if (!raw || typeof raw !== "object" || !("results" in raw)) return [];
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const seen = new Set<string>();
  const suggestions: AddressSuggestion[] = [];
  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const item = result as GeoapifyResult;
    const label = typeof item.formatted === "string" ? item.formatted.trim() : "";
    const postalCode =
      typeof item.postcode === "string" ? item.postcode.trim().toUpperCase() : "";
    const resultType = typeof item.result_type === "string" ? item.result_type : "";
    if (!label || !postalCode || !["building", "street"].includes(resultType)) continue;
    if (seen.has(label)) continue;

    seen.add(label);
    suggestions.push({ label, postalCode });
    if (suggestions.length === 8) break;
  }

  return suggestions;
}
