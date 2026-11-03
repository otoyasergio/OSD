import { describe, expect, it } from "vitest";
import { parseBoxId } from "@/lib/bikeLink/box";

describe("parseBoxId", () => {
  it("accepts the sticker shape", () => {
    expect(parseBoxId("TM-BL-0007")).toEqual({ ok: true, boxId: "TM-BL-0007" });
  });

  it("rejects a short id and a lower-case id", () => {
    expect(parseBoxId("TM-BL-7").ok).toBe(false);
    expect(parseBoxId("tm-bl-0007").ok).toBe(false);
  });
});
