export function getPartsCanadaConfig(): {
  apiUrl: string;
  apiKey: string;
} {
  const apiUrl = (
    process.env.PARTS_CANADA_API_URL ?? "https://api.partscanada.com/api/v2"
  ).replace(/\/$/, "");
  const apiKey = process.env.PARTS_CANADA_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("PARTS_CANADA_NOT_CONFIGURED");
  }

  return { apiUrl, apiKey };
}

export function isPartsCanadaConfigured(): boolean {
  return Boolean(process.env.PARTS_CANADA_API_KEY?.trim());
}
