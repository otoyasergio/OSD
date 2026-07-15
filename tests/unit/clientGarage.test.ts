import { describe, expect, it } from "vitest";
import {
  pickPrimaryPhotoForMotorcycle,
  toGarageBikeCards,
} from "@/lib/services/clientGarage";

describe("client garage", () => {
  it("picks primary photo from the most recent work order (front preferred)", () => {
    const primary = pickPrimaryPhotoForMotorcycle([
      {
        work_order_id: "older",
        date_created: "2026-01-01T00:00:00Z",
        intake_photo: [
          {
            photo_id: "old-front",
            storage_path: "old/front.jpg",
            category: "front",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
      {
        work_order_id: "newer",
        date_created: "2026-06-01T00:00:00Z",
        intake_photo: [
          {
            photo_id: "new-rear",
            storage_path: "new/rear.jpg",
            category: "rear",
            created_at: "2026-06-01T00:00:00Z",
          },
          {
            photo_id: "new-front",
            storage_path: "new/front.jpg",
            category: "front",
            created_at: "2026-06-02T00:00:00Z",
          },
        ],
      },
    ]);

    expect(primary?.photo_id).toBe("new-front");
    expect(primary?.storage_path).toBe("new/front.jpg");
  });

  it("returns null when the motorcycle has no work-order photos", () => {
    expect(pickPrimaryPhotoForMotorcycle([])).toBeNull();
    expect(
      pickPrimaryPhotoForMotorcycle([
        {
          work_order_id: "wo-1",
          date_created: "2026-06-01T00:00:00Z",
          intake_photo: [],
        },
      ])
    ).toBeNull();
  });

  it("falls back to an older work order when the newest has no photos", () => {
    const primary = pickPrimaryPhotoForMotorcycle([
      {
        work_order_id: "empty",
        date_created: "2026-07-01T00:00:00Z",
        intake_photo: [],
      },
      {
        work_order_id: "with-photos",
        date_created: "2026-05-01T00:00:00Z",
        intake_photo: [
          {
            photo_id: "side",
            storage_path: "side.jpg",
            category: "left_side",
            created_at: "2026-05-01T00:00:00Z",
          },
        ],
      },
    ]);

    expect(primary?.photo_id).toBe("side");
  });

  it("maps motorcycles into garage cards with signed photo urls and VIN flags", () => {
    const cards = toGarageBikeCards(
      [
        {
          motorcycle_id: "bike-1",
          year: 2022,
          make: "Honda",
          model: "CBR600RR",
          colour: "Red",
          vin: null,
          plate_number: null,
        },
        {
          motorcycle_id: "bike-2",
          year: 2019,
          make: "Yamaha",
          model: "MT-07",
          colour: "Blue",
          vin: "JYARN06E0KA000001",
          plate_number: "AB123",
        },
      ],
      new Map([
        ["bike-1", "https://signed.example/front.jpg"],
        ["bike-2", null],
      ])
    );

    expect(cards).toEqual([
      {
        motorcycle_id: "bike-1",
        year: 2022,
        make: "Honda",
        model: "CBR600RR",
        colour: "Red",
        vin: null,
        plate_number: null,
        missing_vin: true,
        primary_photo_url: "https://signed.example/front.jpg",
        href: "/motorcycles/bike-1",
      },
      {
        motorcycle_id: "bike-2",
        year: 2019,
        make: "Yamaha",
        model: "MT-07",
        colour: "Blue",
        vin: "JYARN06E0KA000001",
        plate_number: "AB123",
        missing_vin: false,
        primary_photo_url: null,
        href: "/motorcycles/bike-2",
      },
    ]);
  });
});
