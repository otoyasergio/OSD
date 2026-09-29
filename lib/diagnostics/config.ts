export const DEFAULT_DIAGNOSTICS_MODEL = "gpt-6-astra";
export const DEFAULT_DIAGNOSTICS_TIMEOUT_MS = 60_000;
export const DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS = 16_384;

export type DiagnosticsConfig = {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

type DiagnosticsEnvironment = Readonly<Record<string, string | undefined>>;

const MODEL_ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;

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

export function getDiagnosticsTimeoutMs(
  env: DiagnosticsEnvironment = process.env
): number {
  return integerSetting(
    env,
    "OTOMOTO_DIAGNOSTICS_TIMEOUT_MS",
    "DIAGNOSTICS_AI_TIMEOUT_INVALID",
    DEFAULT_DIAGNOSTICS_TIMEOUT_MS,
    10_000,
    120_000
  );
}

export function getDiagnosticsConfig(
  env: DiagnosticsEnvironment = process.env
): DiagnosticsConfig {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) throw new Error("DIAGNOSTICS_AI_NOT_CONFIGURED");

  const model = env.OTOMOTO_DIAGNOSTICS_MODEL?.trim() || DEFAULT_DIAGNOSTICS_MODEL;
  if (!MODEL_ALIAS_PATTERN.test(model)) {
    throw new Error("DIAGNOSTICS_AI_MODEL_INVALID");
  }

  return {
    apiKey,
    model,
    timeoutMs: getDiagnosticsTimeoutMs(env),
    maxOutputTokens: integerSetting(
      env,
      "OTOMOTO_DIAGNOSTICS_MAX_OUTPUT_TOKENS",
      "DIAGNOSTICS_AI_OUTPUT_LIMIT_INVALID",
      DEFAULT_DIAGNOSTICS_MAX_OUTPUT_TOKENS,
      1_024,
      32_768
    ),
  };
}

export type AskOtomotoConfigReason =
  "not_configured" | "model_invalid" | "timeout_invalid" | "output_limit_invalid";

export type AskOtomotoPublicConfig = {
  configured: boolean;
  /** Display-only model alias; never the provider key. */
  modelLabel: string | null;
  reason: AskOtomotoConfigReason | null;
};

const PUBLIC_CONFIG_REASONS: Readonly<Record<string, AskOtomotoConfigReason>> = {
  DIAGNOSTICS_AI_NOT_CONFIGURED: "not_configured",
  DIAGNOSTICS_AI_MODEL_INVALID: "model_invalid",
  DIAGNOSTICS_AI_TIMEOUT_INVALID: "timeout_invalid",
  DIAGNOSTICS_AI_OUTPUT_LIMIT_INVALID: "output_limit_invalid",
};

/**
 * Same validation as the generation path, reduced to a client-safe summary so
 * the UI never offers sends the server would reject.
 */
export function getAskOtomotoPublicConfig(
  env: DiagnosticsEnvironment = process.env
): AskOtomotoPublicConfig {
  const model = env.OTOMOTO_DIAGNOSTICS_MODEL?.trim() || DEFAULT_DIAGNOSTICS_MODEL;
  const modelLabel = MODEL_ALIAS_PATTERN.test(model) ? model : null;
  try {
    getDiagnosticsConfig(env);
    return { configured: true, modelLabel, reason: null };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return {
      configured: false,
      modelLabel,
      reason: PUBLIC_CONFIG_REASONS[code] ?? "not_configured",
    };
  }
}

export function isDiagnosticsAiConfigured(
  env: DiagnosticsEnvironment = process.env
): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}
