/** Parts Canada SKU pattern (NNNN-NNNN). */
export const PC_SKU_RE = /^\d{3,4}-\d{3,4}$/;

export function looksLikeShoppableSku(value: unknown): boolean {
  if (value == null) return false;
  return PC_SKU_RE.test(String(value).trim());
}

export function parsePartValue(raw: unknown): { code: string | null; pc: string | null } {
  const v = String(raw ?? "").trim();
  const m = v.match(/^(.*\S)\s*\(([^)]+)\)\s*$/);
  if (m) return { code: m[1].trim(), pc: m[2].trim() };
  if (PC_SKU_RE.test(v)) return { code: null, pc: v };
  return { code: v || null, pc: null };
}

/** Normalize SKU for catalog lookup (handles leading-zero drift). */
export function skuLookupVariants(raw: string): string[] {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);
  const m = trimmed.match(/^(\d{3,4})-(\d{3,4})$/);
  if (m) {
    const left = m[1].replace(/^0+/, "") || "0";
    const right = m[2].replace(/^0+/, "") || "0";
    variants.add(`${left.padStart(4, "0")}-${right.padStart(4, "0")}`);
    variants.add(`${left}-${right}`);
    if (m[1].length === 4 && m[1].startsWith("0")) {
      variants.add(`${m[1].slice(1)}-${m[2]}`);
    }
  }
  return [...variants];
}

export function extractPartNumbers(
  partData: Record<string, unknown>,
  excludeFields = new Set(["make", "model", "category", "yearStart", "yearEnd"])
): { field: string; value: string; pcSku: string | null }[] {
  const out: { field: string; value: string; pcSku: string | null }[] = [];
  for (const [field, raw] of Object.entries(partData)) {
    if (excludeFields.has(field)) continue;
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const parsed = parsePartValue(value);
    out.push({
      field,
      value,
      pcSku: parsed.pc ?? (looksLikeShoppableSku(value) ? value : null),
    });
  }
  return out;
}

export function collectCatalogSkus(
  parts: { field: string; value: string; pcSku: string | null }[]
): string[] {
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.pcSku) {
      for (const v of skuLookupVariants(part.pcSku)) seen.add(v);
    }
  }
  return [...seen];
}
