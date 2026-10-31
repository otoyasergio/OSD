const METRICS_BASE_URL = "https://metrics.local";

export function shouldCollectPublicMetrics(url: string): boolean {
  try {
    const pathname = new URL(url, METRICS_BASE_URL).pathname;
    return pathname !== "/p" && !pathname.startsWith("/p/");
  } catch {
    return false;
  }
}
