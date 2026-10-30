import { getGmailOAuthConfig, isGmailOAuthConfigured } from "@/lib/email/config";
import { sendGmailApiMessage } from "@/lib/email/gmail";
import {
  getShopMailbox,
  getShopMailboxAddress,
  isCustomerEmailLocation,
  updateShopMailboxRefreshToken,
} from "@/lib/email/mailbox";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

export async function isEmailConfigured(locationId: string): Promise<boolean> {
  if (!isGmailOAuthConfigured()) return false;
  if (!(await isCustomerEmailLocation(locationId))) return false;
  return Boolean(await getShopMailboxAddress(locationId));
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  locationId: string;
}): Promise<{ id: string }> {
  if (!isGmailOAuthConfigured()) throw new Error("EMAIL_NOT_CONFIGURED");
  if (!(await isCustomerEmailLocation(input.locationId))) {
    throw new Error("EMAIL_NOT_CONFIGURED");
  }
  const mailbox = await getShopMailbox(input.locationId);
  if (!mailbox) throw new Error("EMAIL_NOT_CONFIGURED");

  const config = getGmailOAuthConfig();
  const result = await sendGmailApiMessage({
    refreshToken: mailbox.refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    fromAddress: mailbox.emailAddress,
    fromName: TORONTO_SHOP.legalName,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? "",
  });

  if (result.refreshToken && result.refreshToken !== mailbox.refreshToken) {
    await updateShopMailboxRefreshToken(input.locationId, result.refreshToken);
  }

  return { id: result.id };
}

export { isGmailOAuthConfigured };
