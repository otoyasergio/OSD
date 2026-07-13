export type SmsConsentSnapshot = {
  sms_opted_out_at: string | null;
  sms_transactional_consent_at: string | null;
  sms_marketing_consent_at: string | null;
  sms_consent_source: string | null;
};

export type SmsProgram = "transactional" | "marketing";

export function canSendTransactionalSms(c: SmsConsentSnapshot): boolean {
  if (c.sms_opted_out_at) return false;
  const touched = c.sms_consent_source != null;
  if (!touched) return true;
  return c.sms_transactional_consent_at != null;
}

export function canSendMarketingSms(c: SmsConsentSnapshot): boolean {
  if (c.sms_opted_out_at) return false;
  return c.sms_marketing_consent_at != null;
}

const OPT_OUT = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "HALT",
]);
const OPT_IN_CLEAR = new Set(["START", "UNSTOP"]);
const HELP = new Set(["HELP", "INFO", "SUPPORT"]);

export type InboundKeywordKind = "opt_out" | "opt_in_clear" | "help" | "other";

export function classifyInboundSmsKeyword(body: string): InboundKeywordKind {
  const key = body.trim().toUpperCase();
  if (OPT_OUT.has(key)) return "opt_out";
  if (OPT_IN_CLEAR.has(key)) return "opt_in_clear";
  if (HELP.has(key)) return "help";
  return "other";
}

export function buildHelpReply(): string {
  return "Toronto Moto: For help visit torontomoto.com. Message frequency varies. Msg & data rates may apply. Reply STOP to cancel.";
}

export function buildOptOutReply(): string {
  return "Toronto Moto: You are unsubscribed. No more messages will be sent. Visit torontomoto.com for help.";
}

export function buildOptInConfirmation(programs: SmsProgram[]): string {
  const label =
    programs.includes("transactional") && programs.includes("marketing")
      ? "service updates and promotional offers"
      : programs.includes("marketing")
        ? "promotional offers"
        : "service updates";
  return `Toronto Moto: Welcome to our text alerts! You are enrolled for ${label}. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to cancel.`;
}
