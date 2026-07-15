/**
 * Sanitize owner/manager-authored contract HTML before storage and render.
 * Uses a dependency-free stripper so Next.js server/RSC bundles stay free of
 * isomorphic-dompurify/jsdom circular-init issues.
 */
export function sanitizeContractHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/<meta[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*javascript:[^\s>]*/gi, '$1="#"');
}
