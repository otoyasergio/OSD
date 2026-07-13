export function twimlMessageResponse(message?: string | null): string {
  if (!message) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}
