import { getCurrentAppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  DashboardViewParams,
  SavedDashboardView,
} from "@/lib/services/dashboardViewShared";

export type { DashboardViewParams, SavedDashboardView };
export { buildDashboardHref } from "@/lib/services/dashboardViewShared";

export const DASHBOARD_VIEWS_KEY = "dashboard_views";
export const DASHBOARD_DENSITY_KEY = "dashboard_density";
export const DASHBOARD_HIDDEN_COLUMNS_KEY = "dashboard_hidden_columns";
export const DASHBOARD_VIEW_MODE_KEY = "dashboard_view_mode";

export type DashboardViewMode = "board" | "list" | "cards";

type DashboardViewsPayload = {
  views: SavedDashboardView[];
};

async function requirePreferenceUser() {
  const user = await getCurrentAppUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseDashboardViews(value: unknown): SavedDashboardView[] {
  const obj = asObject(value);
  const raw = obj?.views;
  if (!Array.isArray(raw)) return [];

  const views: SavedDashboardView[] = [];
  for (const entry of raw) {
    const row = asObject(entry);
    if (!row) continue;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const params = asObject(row.params) ?? {};
    if (!id || !name) continue;
    views.push({
      id,
      name,
      params: {
        view: typeof params.view === "string" ? params.view : undefined,
        status: typeof params.status === "string" ? params.status : undefined,
        technician_id:
          typeof params.technician_id === "string" ? params.technician_id : undefined,
        flag: typeof params.flag === "string" ? params.flag : undefined,
        q: typeof params.q === "string" ? params.q : undefined,
        hide_empty: typeof params.hide_empty === "string" ? params.hide_empty : undefined,
        density: typeof params.density === "string" ? params.density : undefined,
        card: typeof params.card === "string" ? params.card : undefined,
      },
    });
  }
  return views;
}

async function getPreference(prefKey: string): Promise<unknown | null> {
  const user = await requirePreferenceUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_preference")
    .select("pref_value")
    .eq("user_id", user.user_id)
    .eq("pref_key", prefKey)
    .maybeSingle();
  if (error) throw error;
  return data?.pref_value ?? null;
}

/** One round-trip for all dashboard preference keys used on /dashboard. */
export async function getDashboardShellPreferences(): Promise<{
  savedViews: SavedDashboardView[];
  density: "compact" | "comfortable" | null;
  viewMode: DashboardViewMode | null;
  hiddenColumnIds: string[];
}> {
  const user = await requirePreferenceUser();
  const supabase = await createClient();
  const keys = [
    DASHBOARD_VIEWS_KEY,
    DASHBOARD_DENSITY_KEY,
    DASHBOARD_VIEW_MODE_KEY,
    DASHBOARD_HIDDEN_COLUMNS_KEY,
  ];
  const { data, error } = await supabase
    .from("user_preference")
    .select("pref_key, pref_value")
    .eq("user_id", user.user_id)
    .in("pref_key", keys);
  if (error) throw error;

  const byKey = new Map(
    (data ?? []).map((row) => [row.pref_key as string, row.pref_value])
  );

  return {
    savedViews: parseDashboardViews(byKey.get(DASHBOARD_VIEWS_KEY) ?? null),
    density: parseDensity(byKey.get(DASHBOARD_DENSITY_KEY) ?? null),
    viewMode: parseViewMode(byKey.get(DASHBOARD_VIEW_MODE_KEY) ?? null),
    hiddenColumnIds: parseHiddenColumns(byKey.get(DASHBOARD_HIDDEN_COLUMNS_KEY) ?? null),
  };
}

function parseDensity(value: unknown): "compact" | "comfortable" | null {
  if (value === "comfortable" || value === "compact") return value;
  const obj = asObject(value);
  if (obj?.density === "comfortable" || obj?.density === "compact") {
    return obj.density;
  }
  return null;
}

function parseViewMode(value: unknown): DashboardViewMode | null {
  if (value === "board" || value === "list" || value === "cards") return value;
  const obj = asObject(value);
  if (obj?.view === "board" || obj?.view === "list" || obj?.view === "cards") {
    return obj.view;
  }
  return null;
}

function parseHiddenColumns(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === "string");
  }
  const obj = asObject(value);
  if (Array.isArray(obj?.columns)) {
    return obj.columns.filter((id): id is string => typeof id === "string");
  }
  return [];
}

async function setPreference(prefKey: string, prefValue: unknown): Promise<void> {
  const user = await requirePreferenceUser();
  const supabase = await createClient();
  const { error } = await supabase.from("user_preference").upsert(
    {
      user_id: user.user_id,
      pref_key: prefKey,
      pref_value: prefValue,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,pref_key" }
  );
  if (error) throw error;
}

export async function listSavedDashboardViews(): Promise<SavedDashboardView[]> {
  const value = await getPreference(DASHBOARD_VIEWS_KEY);
  return parseDashboardViews(value);
}

export async function saveDashboardView(
  name: string,
  params: DashboardViewParams
): Promise<SavedDashboardView> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("VIEW_NAME_REQUIRED");
  if (trimmed.length > 60) throw new Error("VIEW_NAME_TOO_LONG");

  const views = await listSavedDashboardViews();
  const saved: SavedDashboardView = {
    id: crypto.randomUUID(),
    name: trimmed,
    params,
  };
  const next: DashboardViewsPayload = { views: [...views, saved] };
  await setPreference(DASHBOARD_VIEWS_KEY, next);
  return saved;
}

export async function deleteDashboardView(viewId: string): Promise<void> {
  const views = await listSavedDashboardViews();
  const next: DashboardViewsPayload = {
    views: views.filter((view) => view.id !== viewId),
  };
  await setPreference(DASHBOARD_VIEWS_KEY, next);
}

export async function getDashboardDensityPreference(): Promise<
  "compact" | "comfortable" | null
> {
  return parseDensity(await getPreference(DASHBOARD_DENSITY_KEY));
}

export async function setDashboardDensityPreference(
  density: "compact" | "comfortable"
): Promise<void> {
  await setPreference(DASHBOARD_DENSITY_KEY, density);
}

export async function getDashboardViewModePreference(): Promise<DashboardViewMode | null> {
  return parseViewMode(await getPreference(DASHBOARD_VIEW_MODE_KEY));
}

export async function setDashboardViewModePreference(
  view: DashboardViewMode
): Promise<void> {
  await setPreference(DASHBOARD_VIEW_MODE_KEY, view);
}

export async function getHiddenBoardColumnsPreference(): Promise<string[]> {
  return parseHiddenColumns(await getPreference(DASHBOARD_HIDDEN_COLUMNS_KEY));
}

export async function setHiddenBoardColumnsPreference(
  columnIds: string[]
): Promise<void> {
  await setPreference(DASHBOARD_HIDDEN_COLUMNS_KEY, {
    columns: columnIds,
  });
}
