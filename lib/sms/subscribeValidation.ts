export function validateSmsSubscribeInput(input: {
  phone: string;
  transactional: boolean;
  marketing: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!input.phone.trim()) return { ok: false, error: "Phone is required." };
  if (!input.transactional && !input.marketing) {
    return { ok: false, error: "Choose at least one message type." };
  }
  return { ok: true };
}
