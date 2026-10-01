import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const NON_PHOTO_EXCEPTIONS = new Map<string, string>([
  [
    "components/forms/PreparedFileInput.tsx",
    "shared prepared picker used by profile, customer, and staff documents",
  ],
]);

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const full = join(directory, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, files);
    else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
  }
  return files;
}

function hasNativeLabel(source: string): boolean {
  return /htmlFor=/.test(source) || /<label[\s>]/.test(source);
}

describe("file input source contract", () => {
  it("classifies every app file input as prepared, photo-file-input, or a documented exception", () => {
    const files = walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")));
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!/type=["']file["']/.test(src)) continue;
      const rel = relative(ROOT, file);
      if (NON_PHOTO_EXCEPTIONS.has(rel)) continue;
      const prepared = /PreparedFileInput/.test(src);
      const reader = /readPickedPhotoFiles|readPickedUploadFiles/.test(src);
      const photoClass = /photo-file-input/.test(src);
      const labeled = hasNativeLabel(src);
      if (prepared || (reader && photoClass && labeled)) continue;
      offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    expect(NON_PHOTO_EXCEPTIONS.size).toBeGreaterThan(0);
  });

  it("keeps evidence surfaces off legacy direct photo upload helpers", () => {
    const surfaces = [
      "components/photos/PhotosTab.tsx",
      "components/photos/CheckoutEvidencePanel.tsx",
      "components/inspections/InspectionPhotoSlot.tsx",
      "components/technician/FloorPhotoField.tsx",
      "components/forms/IntakePhotoSlots.tsx",
      "components/forms/OptionalIntakePhotos.tsx",
      "components/diagnostics/DiagnosticsPhotoPicker.tsx",
    ];
    for (const relativePath of surfaces) {
      const src = readFileSync(join(ROOT, relativePath), "utf8");
      expect(src, relativePath).not.toMatch(/withPhotoUploadRetries/);
      expect(src, relativePath).not.toMatch(/uploadIntakePhotoAction/);
      expect(src, relativePath).not.toMatch(/formData\.append\(\s*["']file["']/);
    }
  });
});
