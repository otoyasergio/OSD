import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");

describe("Apple HIG design tokens", () => {
  it("uses the Apple system font stack for UI type", () => {
    expect(css).toMatch(/-apple-system/);
    expect(css).toMatch(/BlinkMacSystemFont/);
    expect(css).toMatch(/"SF Pro Text"/);
    expect(layout).not.toMatch(/Space_Grotesk/);
  });

  it("keeps the 44px minimum tap target", () => {
    expect(css).toMatch(/--tap-min:\s*2\.75rem/);
  });

  it("uses Apple system colors for semantic status", () => {
    expect(css).toMatch(/--status-danger:\s*#ff3b30/i);
    expect(css).toMatch(/--status-success:\s*#34c759/i);
    expect(css).toMatch(/--status-warning:\s*#ff9500/i);
    expect(css).toMatch(/--status-info:\s*#007aff/i);
    expect(css).toMatch(/--tint:\s*#007aff/i);
  });

  it("pins the iPhone tab bar above the home indicator", () => {
    expect(css).toMatch(/--tab-bar-height:\s*3\.0625rem/);
    expect(css).toMatch(/\.app-tab-bar\s*\{/);
    expect(css).toMatch(
      /height:\s*calc\(\s*var\(--tab-bar-height\)\s*\+\s*env\(safe-area-inset-bottom/
    );
    expect(css).toMatch(
      /\.app-shell--has-tab-bar \.main-body[\s\S]*padding-bottom:\s*calc\(/
    );
  });

  it("respects Reduce Motion on chrome transitions", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(
      /\.sidebar,\s*\n\s*\.sidebar-backdrop \{\s*\n\s*transition: none;/
    );
  });
});
