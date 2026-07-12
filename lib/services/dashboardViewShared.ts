export type DashboardViewParams = {
  view?: string;
  status?: string;
  technician_id?: string;
  flag?: string;
  q?: string;
  hide_empty?: string;
  density?: string;
  card?: string;
};

export type SavedDashboardView = {
  id: string;
  name: string;
  params: DashboardViewParams;
};

export function buildDashboardHref(params: DashboardViewParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}
