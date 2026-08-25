function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapResponse(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function missedCallTwiml(): string {
  return wrapResponse(
    `<Say voice="alice">Toronto Moto missed your call. Please try again during shop hours.</Say><Hangup/>`
  );
}

export function inboundDialClientsTwiml(args: {
  identities: string[];
  timeoutSeconds: number;
}): string {
  const clients = args.identities
    .map((identity) => `<Client>${escapeXml(identity)}</Client>`)
    .join("");
  return wrapResponse(`<Dial timeout="${args.timeoutSeconds}">${clients}</Dial>`);
}

export function outboundPstnTwiml(args: { toE164: string; callerId: string }): string {
  return wrapResponse(
    `<Dial callerId="${escapeXml(args.callerId)}"><Number>${escapeXml(args.toE164)}</Number></Dial>`
  );
}

export function outboundStaffTwiml(args: { identity: string }): string {
  return wrapResponse(`<Dial><Client>${escapeXml(args.identity)}</Client></Dial>`);
}
