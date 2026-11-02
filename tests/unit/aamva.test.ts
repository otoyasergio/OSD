import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { writeBarcode } from "zxing-wasm/writer";
import { parseAamvaLicence } from "@/lib/id/aamva";
import { readLicenceBarcode } from "@/lib/id/readLicenceBarcode";

const EXPECTED = {
  firstName: "ADA MARIE",
  lastName: "LOVELACE",
  dateOfBirth: "1990-01-01",
  licenceExpiry: "2030-01-01",
  licenceNumber: "D1234-56789-01234",
};

const SPEC_PAYLOAD = [
  "@\n\u001e\rANSI 636012090002DL00410288ZO03290015DLDAQD1234-56789-01234",
  "DCSLOVELACE",
  "DCTADA MARIE",
  "DAG99 RIVER STREET",
  "DAITORONTO",
  "DAJON",
  "DAKM5A 3P4",
  "DBB01011990",
  "DBA01012030\r",
].join("\n");

describe("Ontario licence barcode", () => {
  it("reads a spec barcode whose licence number is glued to the header", () => {
    const scan = parseAamvaLicence(SPEC_PAYLOAD);
    expect(scan).toMatchObject(EXPECTED);
    expect(scan?.address).toBe("99 RIVER STREET, TORONTO, ON, M5A 3P4");
  });

  it("reads the human-readable text ZXing returns by default", () => {
    const hri =
      "@<LF><RS><CR>ANSI 636012090002DL00410288ZO03290015DLDAQD1234-56789-01234<LF>DCSLOVELACE<LF>DCTADA,MARIE<LF>DAG99 RIVER STREET<LF>DAITORONTO<LF>DAJON<LF>DAKM5A 3P4<LF>DBB01011990<LF>DBA01012030<CR>";
    const scan = parseAamvaLicence(hri);
    expect(scan).toMatchObject(EXPECTED);
    expect(scan?.address).toContain("99 RIVER STREET");
  });

  it("reads a subfile whose first element keeps the DL prefix", () => {
    const scan = parseAamvaLicence(
      [
        "@",
        "ANSI 636012090002DL00410288ZO03290015DL",
        "DLDAQD1234-56789-01234",
        "DCSLOVELACE",
        "DACADA",
        "DAG99 RIVER STREET",
        "DAITORONTO",
        "DAJON",
        "DAKM5A 3P4",
        "DBB01011990",
        "DBA01012030",
      ].join("\n")
    );
    expect(scan).toMatchObject({
      firstName: "ADA",
      lastName: "LOVELACE",
      licenceNumber: "D1234-56789-01234",
    });
  });

  it("reads a PDF417 photo of a real AAMVA payload", async () => {
    const written = await writeBarcode(SPEC_PAYLOAD, {
      format: "PDF417",
      scale: 3,
      options: "eclevel=4",
    });
    expect(written.image).toBeTruthy();
    const bytes = new Uint8Array(await written.image!.arrayBuffer());
    const scan = await readLicenceBarcode(bytes);
    expect(scan).toMatchObject(EXPECTED);
    expect(scan?.address).toContain("99 RIVER STREET");
  });

  it("reads a JPEG photo with the barcode sitting on a card", async () => {
    const written = await writeBarcode(SPEC_PAYLOAD, {
      format: "PDF417",
      scale: 3,
      options: "eclevel=4",
    });
    const png = Buffer.from(await written.image!.arrayBuffer());
    const jpeg = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 236, g: 232, b: 220 },
      },
    })
      .composite([{ input: png, left: 80, top: 420 }])
      .jpeg({ quality: 80 })
      .toBuffer();

    const scan = await readLicenceBarcode(jpeg);
    expect(scan).toMatchObject(EXPECTED);
  });
});

describe("licence photo picker", () => {
  it("copies the picked photo before the file input is cleared", () => {
    const src = readFileSync("components/customers/LicenceBarcodeScan.tsx", "utf8");
    const copyAt = src.indexOf("file.arrayBuffer()");
    const clearAt = src.indexOf('input.value = ""');
    expect(copyAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(copyAt);
    expect(src).toContain("readLicenceBarcode");
    expect(src).not.toContain('event.target.value = ""');
  });
});
