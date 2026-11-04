const LEGAL_ENTITY_PATTERN = /otomoto\s+toronto\s+moto\s+inc\.?/i;

/** Visible contract text. Matches the App Builder action's body check. */
export function visibleContractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

export function contractNamesLegalEntity(html: string): boolean {
  return LEGAL_ENTITY_PATTERN.test(visibleContractText(html));
}

export function assertContractNamesLegalEntity(html: string): void {
  if (!contractNamesLegalEntity(html)) {
    throw new Error("CONTRACT_LEGAL_ENTITY_REQUIRED");
  }
}
