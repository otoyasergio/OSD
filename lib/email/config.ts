export function getEmailConfig(): {
  apiKey: string;
  fromAddress: string;
  fromName: string;
} {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? "shop@torontomoto.com";
  const fromName = process.env.EMAIL_FROM_NAME ?? "Toronto Moto";

  if (!apiKey) throw new Error("EMAIL_NOT_CONFIGURED");

  return { apiKey, fromAddress, fromName };
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}
