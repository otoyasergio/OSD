import { getAskOtomotoPublicConfig } from "@/lib/diagnostics/config";

export type DiagnosticsHealthStatus = "ok" | "missing" | "error";

export function askOtomotoHealthStatus(
  env: Readonly<Record<string, string | undefined>> = process.env
): DiagnosticsHealthStatus {
  const config = getAskOtomotoPublicConfig(env);
  if (config.configured) return "ok";
  return config.reason === "not_configured" ? "missing" : "error";
}
