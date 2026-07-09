import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  DASHBOARD_CARDS,
  getDashboardData,
  type DashboardCardKey,
} from "@/lib/services/dashboard";
import { canCreateWorkOrder } from "@/lib/permissions";
import {
  getDashboardDensityPreference,
  getDashboardViewModePreference,
  getHiddenBoardColumnsPreference,
  listSavedDashboardViews,
  type DashboardViewMode,
} from "@/lib/services/userPreferences";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShopBoard } from "@/components/work_orders/ShopBoard";
import { WorkOrderListView } from "@/components/work_orders/WorkOrderListView";
import { WorkOrderCardsView } from "@/components/work_orders/WorkOrderCardsView";
import { DashboardFilterChips } from "@/components/work_orders/DashboardFilterChips";
import { SavedViewsBar } from "@/components/work_orders/SavedViewsBar";
import { BoardPrefsControls } from "@/components/work_orders/BoardPrefsControls";
import { DashboardViewToggle } from "@/components/work_orders/DashboardViewToggle";
import { SELECT_CLASS } from "@/components/forms/Field";
import type { WorkOrderStatus } from "@/lib/database/types";

export const dynamic = "force-dynamic";

function buildHref(params: Record<string, string | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

function resolveView(
  raw: string | undefined,
  saved: DashboardViewMode | null
): DashboardViewMode {
  if (raw === "list" || raw === "table") return "list";
  if (raw === "cards" || raw === "card") return "cards";
  if (raw === "board" || raw === "columns") return "board";
  if (saved === "list" || saved === "cards" || saved === "board") return saved;
  return "board";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    technician_id?: string;
    flag?: string;
    q?: string;
    card?: string;
    view?: string;
    hide_empty?: string;
    density?: string;
  }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const canCreate = canCreateWorkOrder(user.role);
  const params = await searchParams;
  const [data, savedViews, savedDensity, savedViewMode, hiddenColumnIds] =
    await Promise.all([
      getDashboardData({
        status: (params.status as WorkOrderStatus) || "",
        technician_id: params.technician_id || "",
        flag: params.flag || "",
        q: params.q || "",
        card: (params.card as DashboardCardKey) || "",
      }),
      listSavedDashboardViews().catch(() => []),
      getDashboardDensityPreference().catch(() => null),
      getDashboardViewModePreference().catch(() => null),
      getHiddenBoardColumnsPreference().catch(() => [] as string[]),
    ]);

  const view = resolveView(params.view, savedViewMode);
  const hideEmpty = params.hide_empty === "1";

  // URL params override persisted density; otherwise use saved preference.
  const density: "compact" | "comfortable" =
    params.density === "comfortable" || params.density === "compact"
      ? params.density
      : (savedDensity ?? "compact");

  const filterBase = {
    status: data.filters.status || undefined,
    technician_id: data.filters.technician_id || undefined,
    flag: data.filters.flag || undefined,
    q: data.filters.q || undefined,
    view,
    hide_empty: hideEmpty ? "1" : undefined,
    density: density === "comfortable" ? "comfortable" : undefined,
    card: data.filters.card || undefined,
  };

  return (
    <div className="page-stack page-stack--wide">
      <PageHeader
        title="Dashboard"
        subtitle="Shop-floor command center for the active location."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canCreate ? (
              <Link href="/work_orders/new" className="btn btn-primary">
                New work order
              </Link>
            ) : null}
            <DashboardViewToggle view={view} filterBase={filterBase} />
          </div>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {DASHBOARD_CARDS.map((card) => {
          const active = data.filters.card === card.key;
          return (
            <Link
              key={card.key}
              href={buildHref({
                ...filterBase,
                card: active ? undefined : card.key,
              })}
              className={active ? "stat-card stat-card-active" : "stat-card"}
              aria-current={active ? "true" : undefined}
            >
              <span className="stat-card-label">{card.label}</span>
              <span className="stat-card-value">{data.counts[card.key]}</span>
            </Link>
          );
        })}
      </div>

      <form method="get" className="filter-panel">
        <input type="hidden" name="view" value={view} />
        {hideEmpty ? <input type="hidden" name="hide_empty" value="1" /> : null}
        {density === "comfortable" ? (
          <input type="hidden" name="density" value="comfortable" />
        ) : null}
        {data.filters.card ? (
          <input type="hidden" name="card" value={data.filters.card} />
        ) : null}
        <label className="block lg:col-span-2">
          <span className="field-label">Search</span>
          <input
            className="input"
            name="q"
            type="search"
            defaultValue={data.filters.q ?? ""}
            placeholder="WO #, customer, bike, VIN…"
          />
        </label>
        <label className="block">
          <span className="field-label">Status</span>
          <select
            className={SELECT_CLASS}
            name="status"
            defaultValue={data.filters.status ?? ""}
          >
            <option value="">All statuses</option>
            {data.statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Technician</span>
          <select
            className={SELECT_CLASS}
            name="technician_id"
            defaultValue={data.filters.technician_id ?? ""}
          >
            <option value="">All technicians</option>
            {data.technicians.map((tech) => (
              <option key={tech.user_id} value={tech.user_id}>
                {tech.first_name} {tech.last_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Flag</span>
          <select
            className={SELECT_CLASS}
            name="flag"
            defaultValue={data.filters.flag ?? ""}
          >
            <option value="">All flags</option>
            {data.flagOptions.map((flag) => (
              <option key={flag} value={flag}>
                {flag}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5">
          <button type="submit" className="btn btn-primary">
            Apply filters
          </button>
          <Link href={`/dashboard?view=${view}`} className="btn btn-secondary">
            Clear
          </Link>
        </div>
      </form>

      <DashboardFilterChips
        filters={data.filters}
        technicians={data.technicians}
        view={view}
        hideEmpty={hideEmpty}
        density={density}
      />

      <SavedViewsBar views={savedViews} currentParams={filterBase} />

      <BoardPrefsControls
        filterBase={filterBase}
        density={density}
        hideEmpty={hideEmpty}
        hiddenColumnIds={hiddenColumnIds}
        mode={view}
      />

      {data.rows.length === 0 ? (
        <EmptyState
          variant="work-orders"
          title="No work orders"
          description="No work orders match these filters at this location."
          action={{ href: "/work_orders/new", label: "Create work order" }}
        />
      ) : view === "board" ? (
        <ShopBoard
          rows={data.rows}
          hideEmpty={hideEmpty}
          compact={density === "compact"}
          hiddenColumnIds={hiddenColumnIds}
          role={user.role}
          isForeignLocation={false}
        />
      ) : view === "cards" ? (
        <WorkOrderCardsView rows={data.rows} />
      ) : (
        <WorkOrderListView rows={data.rows} hideEmpty={hideEmpty} />
      )}
    </div>
  );
}
