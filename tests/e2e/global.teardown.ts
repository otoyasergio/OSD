import { resetSyntheticShop } from "./fixtures/seedSyntheticShop";

/** Removes the synthetic QA rows seeded by global setup (mutating runs only). */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_ALLOW_MUTATION !== "1") return;
  await resetSyntheticShop();
}
