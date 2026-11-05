import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canOrderPart,
  canSyncPartsCanadaCatalog,
  canViewPartsBoard,
  canViewPricing,
} from "@/lib/permissions";
import { listPartsWaitingForLocation } from "@/lib/services/partsBoard";
import { getPartsCanadaSyncStatus } from "@/lib/services/partsCanadaCatalog";
import { listTechniciansForActiveLocation } from "@/lib/services/workOrders";
import { getFitmentImportStatus } from "@/lib/services/fitment";
import { listOpenPartsToOrder, listPurchaseOrders } from "@/lib/services/purchasing";
import { toFormErrorMessage } from "@/lib/services/errors";
import { PageHeader } from "@/components/ui/PageHeader";
import { PartsWaitingBoard } from "@/components/parts/PartsWaitingBoard";
import { PartsCanadaSyncPanel } from "@/components/parts/PartsCanadaSyncPanel";
import { PurchasingDesk } from "@/components/parts/PurchasingDesk";
import { YmmFitmentFilter } from "@/components/fitment/YmmFitmentFilter";
import { SELECT_CLASS } from "@/components/forms/Field";

export const dynamic = "force-dynamic";

export default async function PartsWaitingPage({
  searchParams,
}: {
  searchParams: Promise<{ technician_id?: string }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const { actor: user, role: viewRole } = preview;
  if (!canViewPartsBoard(viewRole)) redirect("/dashboard");
  if (!user.active_location_id) redirect("/dashboard");

  const params = await searchParams;
  const technicianId = params.technician_id?.trim() || "";
  const canSync = canSyncPartsCanadaCatalog(viewRole);

  const [items, technicians, syncStatus, fitmentStatus, openParts, purchaseOrders] =
    await Promise.all([
      listPartsWaitingForLocation(user.active_location_id, {
        technicianId: technicianId || undefined,
        view: { role: viewRole, subjectUserId: preview.subjectUserId },
      }),
      listTechniciansForActiveLocation(),
      canOrderPart(viewRole)
        ? getPartsCanadaSyncStatus().catch(() => null)
        : Promise.resolve(null),
      getFitmentImportStatus().catch(() => ({ vehicle_count: 0, last_run: null })),
      canOrderPart(viewRole)
        ? listOpenPartsToOrder().catch(() => [])
        : Promise.resolve([]),
      canOrderPart(viewRole)
        ? listPurchaseOrders().catch((error: unknown) => {
            console.warn("purchase orders unavailable", error);
            return { error: toFormErrorMessage(error) };
          })
        : Promise.resolve([]),
    ]);

  const toOrderCount = items.filter((item) => item.bucket === "to_order").length;
  const inStockCount = items.filter((item) => item.bucket === "in_stock").length;
  const orderedCount = items.filter((item) => item.bucket === "ordered").length;

  return (
    <div className="page-stack page-stack--wide">
      <PageHeader
        title="Parts"
        subtitle="To order (after customer approval), in stock, and ordered — across open work orders at this location."
      />

      {syncStatus ? <PartsCanadaSyncPanel status={syncStatus} canSync={canSync} /> : null}

      <div className="card card-pad flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          YMM fitment finder
        </h2>
        <p className="text-sm text-[var(--status-neutral)]">
          {fitmentStatus.vehicle_count > 0
            ? `${fitmentStatus.vehicle_count.toLocaleString()} vehicles in the catalogue${
                fitmentStatus.last_run?.source_path
                  ? ` from ${fitmentStatus.last_run.source_path}`
                  : ""
              }. A catalogue match is a hint until someone confirms fitment on the purchase order.`
            : "Import fitment data with scripts/import-fitment.ts to enable Year / Make / Model lookup. A catalogue match stays a hint until someone confirms fitment."}
        </p>
        {fitmentStatus.vehicle_count > 0 ? <YmmFitmentFilter /> : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:max-w-4xl">
        <div className="stat-card" aria-label={`${items.length} parts total`}>
          <span className="stat-card-label">Total</span>
          <span className="stat-card-value">{items.length}</span>
        </div>
        <div className="stat-card" aria-label={`${toOrderCount} to order`}>
          <span className="stat-card-label">To order</span>
          <span className="stat-card-value">{toOrderCount}</span>
        </div>
        <div className="stat-card" aria-label={`${inStockCount} in stock`}>
          <span className="stat-card-label">In stock</span>
          <span className="stat-card-value">{inStockCount}</span>
        </div>
        <div className="stat-card" aria-label={`${orderedCount} ordered`}>
          <span className="stat-card-label">Ordered</span>
          <span className="stat-card-value">{orderedCount}</span>
        </div>
      </div>

      <form method="get" className="filter-panel sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="field-label">Technician</span>
          <select
            name="technician_id"
            defaultValue={technicianId}
            className={SELECT_CLASS}
            aria-label="Filter by technician"
          >
            <option value="">All technicians</option>
            {technicians.map((tech) => (
              <option key={tech.user_id} value={tech.user_id}>
                {tech.first_name} {tech.last_name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">
            Filter
          </button>
          {technicianId ? (
            <Link href="/parts" className="btn btn-secondary">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {canOrderPart(viewRole) ? (
        Array.isArray(purchaseOrders) ? (
          <PurchasingDesk parts={openParts} orders={purchaseOrders} />
        ) : (
          <p className="card card-pad text-sm text-[var(--status-danger)]" role="alert">
            {purchaseOrders.error}
          </p>
        )
      ) : null}

      <PartsWaitingBoard items={items} canViewPricing={canViewPricing(viewRole)} />
    </div>
  );
}
