/**
 * Hrefs that also exist as prefixes of sibling nav links must match exactly,
 * otherwise e.g. /technician/docket would co-activate "Tech Floor".
 */
const EXACT_MATCH_HREFS = new Set(["/settings", "/technician"]);

export function isActiveNavPath(pathname: string, href: string): boolean {
  if (EXACT_MATCH_HREFS.has(href)) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
