export function getSquareConfig(): {
  accessToken: string;
  locationId: string;
  environment: "sandbox" | "production";
  webhookSignatureKey: string;
} {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN ?? "";
  const locationId = process.env.SQUARE_LOCATION_ID ?? "";
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
  const webhookSignatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? "";

  if (!accessToken || !locationId) {
    throw new Error("SQUARE_NOT_CONFIGURED");
  }

  return { accessToken, locationId, environment, webhookSignatureKey };
}

export function isSquareConfigured(): boolean {
  return Boolean(
    process.env.SQUARE_ACCESS_TOKEN?.trim() &&
      process.env.SQUARE_LOCATION_ID?.trim()
  );
}

export function squareApiBase(environment: "sandbox" | "production"): string {
  return environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}
