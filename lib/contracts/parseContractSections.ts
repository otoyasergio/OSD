export type ContractSection = {
  html: string;
  initialKey: string | null;
};

/**
 * Split contract HTML into ordered section blocks.
 * Sections with data-initial="key" get an interleaved initials slot after them.
 */
export function parseContractSections(html: string): ContractSection[] {
  const trimmed = html.trim();
  if (!trimmed) return [];

  const sectionRegex =
    /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  const sections: ContractSection[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(trimmed)) !== null) {
    const preamble = trimmed.slice(lastIndex, match.index).trim();
    if (preamble) {
      sections.push({ html: preamble, initialKey: null });
    }

    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const full = `<section${attrs}>${body}</section>`;
    const keyMatch = attrs.match(/\bdata-initial\s*=\s*["']([^"']+)["']/i);
    sections.push({
      html: full,
      initialKey: keyMatch?.[1]?.trim() || null,
    });
    lastIndex = match.index + match[0].length;
  }

  const trailing = trimmed.slice(lastIndex).trim();
  if (trailing) {
    sections.push({ html: trailing, initialKey: null });
  }

  if (sections.length === 0) {
    return [{ html: trimmed, initialKey: null }];
  }

  return sections;
}

/** Every initial_fields key that has a matching data-initial section. */
export function interleavedInitialKeys(
  html: string,
  initialFields: string[]
): string[] {
  const sections = parseContractSections(html);
  const present = new Set(
    sections.map((s) => s.initialKey).filter((k): k is string => Boolean(k))
  );
  return initialFields.filter((field) => present.has(field));
}
