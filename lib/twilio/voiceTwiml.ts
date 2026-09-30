function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wrap(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function missedCallTwiml(): string {
  return wrap(
    `<Say>We missed your call. Please try again during shop hours.</Say><Hangup/>`
  );
}

export function inboundPstnTwiml(args: {
  identities: string[];
  actionUrl?: string;
  timeoutSeconds?: number;
  callerName?: string | null;
  phoneCallId?: string | null;
}): string {
  if (args.identities.length === 0) return missedCallTwiml();
  const timeout = args.timeoutSeconds ?? 20;
  const action = args.actionUrl ? ` action="${xmlEscape(args.actionUrl)}"` : "";
  const params = [
    args.callerName
      ? `<Parameter name="callerName" value="${xmlEscape(args.callerName)}"/>`
      : "",
    args.phoneCallId
      ? `<Parameter name="phoneCallId" value="${xmlEscape(args.phoneCallId)}"/>`
      : "",
  ].join("");
  const clients = args.identities
    .map((id) =>
      params
        ? `<Client><Identity>${xmlEscape(id)}</Identity>${params}</Client>`
        : `<Client>${xmlEscape(id)}</Client>`
    )
    .join("");
  return wrap(
    `<Dial answerOnBridge="true" timeout="${timeout}"${action}>${clients}</Dial>`
  );
}

export function outboundPstnTwiml(args: { toE164: string; callerId: string }): string {
  return wrap(
    `<Dial callerId="${xmlEscape(args.callerId)}" answerOnBridge="true"><Number>${xmlEscape(args.toE164)}</Number></Dial>`
  );
}

export function staffAudioTwiml(args: {
  identities: string[];
  conferenceName?: string;
}): string {
  if (args.conferenceName) {
    return wrap(
      `<Dial answerOnBridge="true"><Conference beep="false" startConferenceOnEnter="true" endConferenceOnExit="false">${xmlEscape(args.conferenceName)}</Conference></Dial>`
    );
  }
  const identity = args.identities[0];
  if (!identity) return missedCallTwiml();
  return wrap(
    `<Dial answerOnBridge="true"><Client>${xmlEscape(identity)}</Client></Dial>`
  );
}
