/**
 * Split contract template HTML into wizard steps, one per
 * `<section data-initial="key">` block. Content that does not require an
 * initial (preamble, plain sections) is merged into the following step so
 * nothing is skipped; content after the last initialed section is returned
 * separately for the signature step.
 *
 * Regex-based on purpose: runs in RSC/SSR (no DOMParser) and the template
 * format is controlled via the template editor's data-initial convention.
 */

export type ContractSectionStep = {
  key: string;
  heading: string | null;
  html: string;
};

export type ParsedContractSections = {
  steps: ContractSectionStep[];
  /** Content after the last data-initial section (shown with the signature). */
  trailingHtml: string;
};

const SECTION_RE = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
const DATA_INITIAL_RE = /\bdata-initial\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const HEADING_RE = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i;

function extractHeading(sectionHtml: string): string | null {
  const match = sectionHtml.match(HEADING_RE);
  if (!match) return null;
  const text = match[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** Returns null when the HTML has no data-initial sections (fallback to single-scroll). */
export function parseContractSections(bodyHtml: string): ParsedContractSections | null {
  const steps: ContractSectionStep[] = [];
  let pending = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  SECTION_RE.lastIndex = 0;
  while ((match = SECTION_RE.exec(bodyHtml)) !== null) {
    const [full, attrs] = match;
    const between = bodyHtml.slice(cursor, match.index);
    cursor = match.index + full.length;

    const keyMatch = attrs.match(DATA_INITIAL_RE);
    const key = (keyMatch?.[1] ?? keyMatch?.[2])?.trim();

    if (key) {
      steps.push({
        key,
        heading: extractHeading(full),
        html: `${pending}${between}${full}`,
      });
      pending = "";
    } else {
      // Plain section: carry it into the next initialed step.
      pending += between + full;
    }
  }

  if (steps.length === 0) return null;

  const trailingHtml = `${pending}${bodyHtml.slice(cursor)}`.trim();
  return { steps, trailingHtml };
}
