import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("photos:reconcile uses a pinned local tsx", () => {
  it("declares tsx in devDependencies and runs the local binary", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const lock = readFileSync(join(process.cwd(), "package-lock.json"), "utf8");

    expect(pkg.devDependencies.tsx).toMatch(/^\d+\.\d+\.\d+$|^[\^~]?\d+\./);
    expect(pkg.scripts["photos:reconcile"]).toMatch(
      /^tsx(?: --conditions=react-server)? --env-file-if-exists=\.env\.local scripts\/reconcile-intake-photos\.ts$/
    );
    expect(pkg.scripts["photos:reconcile"]).not.toMatch(/npx/);
    expect(lock).toMatch(/"tsx"/);
    expect(lock).toMatch(/node_modules\/tsx/);
  });
});
