/**
 * Small WMI (positions 1–3) hint map for offline fallback.
 * Region from first character; manufacturer hints for common motorcycle WMIs.
 */

export type WmiHint = {
  region: string;
  country?: string;
  manufacturer?: string;
};

const REGION_BY_FIRST: Record<string, string> = {
  "1": "North America",
  "2": "North America",
  "3": "North America",
  "4": "North America",
  "5": "North America",
  "6": "Oceania",
  "7": "Oceania",
  "8": "South America",
  "9": "South America",
  J: "Asia",
  K: "Asia",
  L: "Asia",
  M: "Asia",
  N: "Asia",
  P: "Asia",
  R: "Asia",
  S: "Europe",
  T: "Europe",
  U: "Europe",
  V: "Europe",
  W: "Europe",
  X: "Europe",
  Y: "Europe",
  Z: "Europe",
};

/** Common motorcycle / powersports WMIs seen in shop work. */
const MANUFACTURER_BY_WMI: Record<string, string> = {
  "1HD": "Harley-Davidson",
  "1G1": "General Motors",
  "5HD": "Harley-Davidson",
  JH2: "Honda",
  JKB: "Kawasaki",
  JKA: "Kawasaki",
  JS1: "Suzuki",
  JS3: "Suzuki",
  JYA: "Yamaha",
  JY4: "Yamaha",
  ZDM: "Ducati",
  ZD4: "Aprilia",
  VBK: "KTM",
  SMB: "Triumph",
  ML3: "Royal Enfield",
  MD2: "Bajaj",
  L5Y: "CFMoto",
  LE8: "Zhejiang Qianjiang / Benelli",
};

export function lookupWmi(wmi: string): WmiHint | null {
  const code = wmi.trim().toUpperCase();
  if (code.length < 1) return null;

  const region = REGION_BY_FIRST[code[0]] ?? "Unknown region";
  const manufacturer =
    (code.length >= 3 ? MANUFACTURER_BY_WMI[code.slice(0, 3)] : undefined) ??
    (code.length >= 2 ? MANUFACTURER_BY_WMI[code.slice(0, 2)] : undefined);

  return {
    region,
    manufacturer,
  };
}
