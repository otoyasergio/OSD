export type IntegrationStatus = "ok" | "missing" | "error";

type IntegrationHealthInput = {
  supabase: IntegrationStatus;
  wix: IntegrationStatus;
  partsCanada: IntegrationStatus;
  cron: IntegrationStatus;
  askOtomoto: IntegrationStatus;
};

export function summarizeIntegrationHealth(
  integrations: IntegrationHealthInput
): { ok: boolean; degraded: boolean } {
  const ok =
    integrations.supabase === "ok" &&
    integrations.wix === "ok" &&
    integrations.partsCanada === "ok" &&
    integrations.cron === "ok";

  return {
    ok,
    degraded: ok && integrations.askOtomoto !== "ok",
  };
}
