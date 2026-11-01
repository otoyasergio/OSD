import { describe, expect, it } from "vitest";
import {
  customerPhotoStoragePath,
  isOwnedCustomerPhotoPath,
} from "@/lib/customers/photoStorage";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";

describe("customer photo paths", () => {
  it("stores one jpeg under the customer's own folder", () => {
    expect(customerPhotoStoragePath(CUSTOMER_ID, PHOTO_ID)).toBe(
      `${CUSTOMER_ID}/${PHOTO_ID}.jpg`
    );
  });

  it("accepts only that customer's jpeg path", () => {
    const path = customerPhotoStoragePath(CUSTOMER_ID, PHOTO_ID);
    expect(isOwnedCustomerPhotoPath(CUSTOMER_ID, path)).toBe(true);
    expect(isOwnedCustomerPhotoPath(OTHER_CUSTOMER_ID, path)).toBe(false);
    expect(isOwnedCustomerPhotoPath(CUSTOMER_ID, `${CUSTOMER_ID}/${PHOTO_ID}.png`)).toBe(
      false
    );
    expect(
      isOwnedCustomerPhotoPath(CUSTOMER_ID, `${CUSTOMER_ID}/../${PHOTO_ID}.jpg`)
    ).toBe(false);
  });
});
