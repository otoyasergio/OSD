const fs = require("node:fs");
const path = require("node:path");

describe("app.config.yaml", () => {
  const manifestPath = path.join(__dirname, "..", "app.config.yaml");
  const manifest = fs.readFileSync(manifestPath, "utf8");

  test("keeps the action under application.runtimeManifest", () => {
    expect(manifest).toMatch(/^application:\n/m);
    expect(manifest).toMatch(/^\s+runtimeManifest:/m);
    expect(manifest).not.toMatch(/^runtimeManifest:/m);
    expect(manifest).toContain("function: actions/compose-drop-off-agreement/index.js");
    expect(manifest).toContain("runtime: nodejs:22");
    expect(manifest).toContain("memory: 256");
    expect(manifest).toContain("require-adobe-auth: false");
    expect(manifest).not.toContain("web: web-src");
    expect(
      fs.existsSync(
        path.join(__dirname, "..", "actions/compose-drop-off-agreement/index.js")
      )
    ).toBe(true);
  });
});
