import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const SURFACES = [
  "components/photos/PhotoLightbox.tsx",
  "components/photos/PhotosTab.tsx",
  "components/inspections/InspectionPhotoSlot.tsx",
  "components/photos/StaffPhotoGrid.tsx",
  "components/work_orders/WorkOrderPhotoStrip.tsx",
  "components/ui/PhotoActionCard.tsx",
  "components/customers/ClientGarage.tsx",
  "components/technician/JobPacketPanel.tsx",
  "components/technician/ReadyForPickupCarousel.tsx",
] as const;

describe("core signed-photo surfaces recover expired signed URLs once", () => {
  it.each(SURFACES)("%s uses RecoverableSignedImage", (relativePath) => {
    const src = source(relativePath);
    expect(src).toMatch(/RecoverableSignedImage/);
  });

  it("PhotoActionCard stays a Server Component and does not attach event handlers to Link", () => {
    const src = source("components/ui/PhotoActionCard.tsx");
    expect(src).not.toMatch(/^["']use client["']/m);
    expect(src).not.toMatch(/\bon[A-Z][A-Za-z]+\s*=/);
    expect(src).toMatch(/RecoverableSignedImage/);
  });

  it("InspectionPhotoSlot still renders local queue previews without signed recovery", () => {
    const src = source("components/inspections/InspectionPhotoSlot.tsx");
    expect(src).toMatch(/previewUrl/);
    expect(src).toMatch(/RecoverableSignedImage/);
  });
});
