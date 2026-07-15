import { describe, it, expect } from "vitest";
import {
  interleavedInitialKeys,
  parseContractSections,
} from "@/lib/contracts/parseContractSections";

describe("parseContractSections", () => {
  it("maps data-initial to initialKey and preserves order", () => {
    const html = `
      <h2>Title</h2>
      <section data-initial="liability"><p>A</p></section>
      <section data-initial="payment"><p>B</p></section>
      <section><p>Misc</p></section>
    `;
    const sections = parseContractSections(html);
    expect(sections[0].initialKey).toBeNull();
    expect(sections[0].html).toContain("Title");
    expect(sections[1].initialKey).toBe("liability");
    expect(sections[2].initialKey).toBe("payment");
    expect(sections[3].initialKey).toBeNull();
  });

  it("returns single block when there are no sections", () => {
    const sections = parseContractSections("<p>Hello</p>");
    expect(sections).toEqual([{ html: "<p>Hello</p>", initialKey: null }]);
  });

  it("lists interleaved slots for every matching initial_fields key", () => {
    const html = `
      <section data-initial="a"><p>1</p></section>
      <section data-initial="b"><p>2</p></section>
    `;
    expect(interleavedInitialKeys(html, ["a", "b", "c"])).toEqual(["a", "b"]);
  });
});
