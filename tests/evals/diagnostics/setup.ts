const missing = [
  process.env.RUN_DIAGNOSTICS_EVALS === "1" ? null : "RUN_DIAGNOSTICS_EVALS=1",
  process.env.OPENAI_API_KEY?.trim() ? null : "OPENAI_API_KEY",
].filter((value): value is string => value !== null);

if (missing.length > 0) {
  throw new Error(
    "Ask OTOMOTO live-model evals are opt-in and make real provider calls. " +
      `Missing: ${missing.join(", ")}. Run only with fictional fixtures, for example: ` +
      "RUN_DIAGNOSTICS_EVALS=1 OPENAI_API_KEY=... npm run test:diagnostics:eval"
  );
}
