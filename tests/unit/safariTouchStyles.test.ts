import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Static gates for the Safari touch rules in the hand-written stylesheets.
 *
 * Touch Safari applies `:hover` on tap and leaves it stuck until the next tap,
 * so hover-only styling must sit under `@media (hover: hover)` — the same guard
 * Tailwind applies to its `hover:` utilities. A long-press on a board card is
 * both the drag activation and Safari's cue for the image/link callout, so the
 * draggable states must opt out of the callout.
 */

const ROOT = process.cwd();

function listCssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listCssFiles(full, out);
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

const STYLESHEETS = [
  join(ROOT, "app/globals.css"),
  ...listCssFiles(join(ROOT, "components")),
];

const HOVER_GUARD = /^@media\s*\(\s*hover\s*:\s*hover\s*\)$/;

/**
 * Returns every rule prelude that contains `:hover` together with the at-rule
 * preludes enclosing it. Comments are stripped first; the stylesheets contain
 * no strings with braces, so a brace walk is sufficient.
 */
function hoverRules(css: string): Array<{ selector: string; ancestors: string[] }> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: string[] = [];
  const found: Array<{ selector: string; ancestors: string[] }> = [];
  let buffer = "";
  for (const char of stripped) {
    if (char === "{") {
      const prelude = buffer.replace(/\s+/g, " ").trim();
      if (!prelude.startsWith("@") && prelude.includes(":hover")) {
        found.push({ selector: prelude, ancestors: [...stack] });
      }
      stack.push(prelude);
      buffer = "";
    } else if (char === "}") {
      stack.pop();
      buffer = "";
    } else if (char === ";") {
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return found;
}

describe("Safari touch styles", () => {
  it("keeps every custom :hover rule under @media (hover: hover)", () => {
    const unguarded: string[] = [];
    for (const file of STYLESHEETS) {
      const css = readFileSync(file, "utf8");
      for (const rule of hoverRules(css)) {
        if (!rule.ancestors.some((ancestor) => HOVER_GUARD.test(ancestor))) {
          unguarded.push(`${relative(ROOT, file)}: ${rule.selector}`);
        }
      }
    }
    expect(unguarded).toEqual([]);
  });

  it("covers the hover rules it is meant to police", () => {
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    expect(hoverRules(css).length).toBeGreaterThan(0);
  });

  it("disables the iOS touch callout on long-press draggable board cards", () => {
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    const block = css.match(
      /\.wo-card-drag-wrap--draggable,\s*\.pit-queue-drag-wrap,[^{]*\{([^}]*)\}/
    );
    expect(block, "shared draggable-card rule").not.toBeNull();
    const body = block?.[1] ?? "";
    expect(body).toContain("-webkit-touch-callout: none");
    expect(body).toContain("-webkit-user-select: none");
    expect(body).toContain("user-select: none");

    const carousel = readFileSync(
      join(ROOT, "components/technician/ReadyForPickupCarousel.module.css"),
      "utf8"
    );
    const cardButton = carousel.match(/\.cardButton\s*\{([^}]*)\}/);
    expect(cardButton?.[1] ?? "").toContain("-webkit-touch-callout: none");
  });
});
