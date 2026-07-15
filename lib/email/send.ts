import { getEmailConfig, isEmailConfigured } from "@/lib/email/config";

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ id: string }> {
  if (!isEmailConfigured()) throw new Error("EMAIL_NOT_CONFIGURED");

  const config = getEmailConfig();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${config.fromName} <${config.fromAddress}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  const data = (await response.json()) as { id?: string; message?: string };
  if (!response.ok) {
    throw new Error(`EMAIL_SEND_FAILED: ${data.message ?? response.statusText}`);
  }

  return { id: data.id ?? "" };
}

export { isEmailConfigured };
