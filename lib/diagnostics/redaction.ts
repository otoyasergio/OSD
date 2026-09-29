export type DiagnosticsRedactTerms = {
  customerName?: string | null;
  phone?: string | null;
  email?: string | null;
  fullVin?: string | null;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactDiagnosticsText(
  value: string,
  terms: DiagnosticsRedactTerms = {}
): string {
  let redacted = value;
  const customerName = terms.customerName?.trim();
  const exactTerms: Array<[string | null | undefined, string]> = [
    [terms.phone, "[REDACTED_PHONE]"],
    [terms.email, "[REDACTED_EMAIL]"],
    [terms.fullVin, "[REDACTED_VIN]"],
  ];
  for (const [term, marker] of exactTerms.sort(
    (a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0)
  )) {
    const normalized = term?.trim();
    if (normalized) {
      redacted = redacted.replace(new RegExp(escapeRegExp(normalized), "gi"), marker);
    }
  }

  redacted = redacted.replace(/https?:\/\/[^\s"'<>]+/gi, "[REDACTED_URL]");
  if (redacted.includes("/")) {
    redacted = redacted.replace(/[^\s"'<>]*\/[^\s"'<>]*/g, (candidate) =>
      /(?:^|\/)(?:storage|photos?|images?|signatures?|documents?|tokens?)(?:\/|$)/i.test(
        candidate
      ) || /\/[^/]+\.(?:jpe?g|png|webp|heic|heif|pdf)(?:[),.;:!?]*)$/i.test(candidate)
        ? "[REDACTED_PATH]"
        : candidate
    );
  }
  redacted = redacted
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "[REDACTED_VIN]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(
      /(?:\+?1[\s.()-]*)?[2-9]\d{2}[\s.()-]*[2-9]\d{2}[\s.()-]*\d{4}\b/g,
      "[REDACTED_PHONE]"
    );
  if (customerName) {
    const nameTerms = [
      customerName,
      ...customerName.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3),
    ]
      .filter((term, index, values) => values.indexOf(term) === index)
      .sort((a, b) => b.length - a.length);
    for (const term of nameTerms) {
      redacted = redacted.replace(
        new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi"),
        (match, offset: number, input: string) => {
          const markerStart = input.lastIndexOf("[REDACTED_", offset);
          const markerEnd = markerStart >= 0 ? input.indexOf("]", markerStart) : -1;
          return markerStart >= 0 && markerEnd >= offset ? match : "[REDACTED_NAME]";
        }
      );
    }
  }
  return redacted;
}
