import { describe, expect, it } from "vitest";
import { withPrimaryPhotoUrls } from "@/lib/workOrders/listPhotos";

describe("work order list photos", () => {
  it("attaches a signed primary photo url to each listed work order", () => {
    const urls = new Map<string, string | null>([
      ["wo-1", "https://signed.example/front.jpg"],
      ["wo-2", null],
    ]);

    expect(
      withPrimaryPhotoUrls(
        [
          { work_order_id: "wo-1", work_order_number: "3597" },
          { work_order_id: "wo-2", work_order_number: "3595" },
          { work_order_id: "wo-3", work_order_number: "3572" },
        ],
        urls
      )
    ).toEqual([
      {
        work_order_id: "wo-1",
        work_order_number: "3597",
        primary_photo_url: "https://signed.example/front.jpg",
      },
      {
        work_order_id: "wo-2",
        work_order_number: "3595",
        primary_photo_url: null,
      },
      {
        work_order_id: "wo-3",
        work_order_number: "3572",
        primary_photo_url: null,
      },
    ]);
  });
});
