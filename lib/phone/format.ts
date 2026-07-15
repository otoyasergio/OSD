/** Format a Canadian/North American number while preserving other international input. */
export function formatCanadianPhoneInput(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return raw;

  let digits = raw.replace(/\D/g, "");
  if (trimmed.startsWith("+1") && digits.length <= 11) {
    digits = digits.slice(1);
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  } else if (digits.length > 10) {
    return raw;
  }

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}
