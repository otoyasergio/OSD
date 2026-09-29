export const DEFAULT_DIAGNOSTICS_MODEL = "gpt-6-astra";
export const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 60_000;
export const DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS = 4_000;

export type DiagnosticsConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

type DiagnosticsEnvironment = Readonly<Record<string, string | undefined>>;

function integerSetting(
  env: DiagnosticsEnvironment,
  name: string,
  errorCode: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(errorCode);
  }
  return value;
}

export function getDiagnosticsConfig(
  env: DiagnosticsEnvironment = process.env
): DiagnosticsConfig {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) throw new Error("DIAGNOSTICS_AI_NOT_CONFIGURED");

  const model = env.OTOMOTO_DIAGNOSTICS_MODEL?.trim() || DEFAULT_DIAGNOSTICS_MODEL;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model)) {
    throw new Error("DIAGNOSTICS_AI_MODEL_INVALID");
  }

  return {
    apiKey,
    model,
    timeoutMs: integerSetting(
      env,
      "OTOMOTO_DIAGNOSTICS_TIMEOUT_MS",
      "DIAGNOSTICS_AI_TIMEOUT_INVALID",
      DEFAULT_DIAGNOSTICS_TIMEOUT_MS,
      10_000,
      120_000
    ),
    maxOutputTokens: integerSetting(
      env,
      "OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS",
      "DIAGNOSTICS_AI_OUTPUT_LIMIT_INVALID",
      DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS,
      1_024,
      16_384
    ),
  };
}

export function isDiagnosticsAiConfigured(
  env: DiagnosticsEnvironment = process.env
): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}
