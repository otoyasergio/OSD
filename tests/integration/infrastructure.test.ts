import { expect, it } from "vitest";
import {
  createServiceClient,
  describeIntegration,
  integrationConfigured,
} from "./helpers";

describeIntegration("integration infrastructure", () => {
  it("connects to the isolated database and selects from location", async () => {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("location")
      .select("location_id, code")
      .limit(5);

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });
});

if (!integrationConfigured()) {
  // Visible marker in `npm run test:integration` output explaining the skip.
  it.skip(
    "integration suite skipped — set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY " +
      "(run `supabase start`, needs Docker)",
    () => {}
  );
}
