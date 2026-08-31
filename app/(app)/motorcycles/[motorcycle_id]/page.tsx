import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMotorcycleById, getServiceInformation } from "@/lib/services/motorcycles";
import { getCustomerById, searchCustomers } from "@/lib/services/customers";
import { listOutstandingRecommendationsForMotorcycle } from "@/lib/services/recommendations";
import { listWorkOrdersForMotorcycle } from "@/lib/services/filedWorkOrders";
import { listIntakePhotosForMotorcycle } from "@/lib/services/photoGallery";
import { buildBikeSnapshot } from "@/lib/motorcycles/bikeSnapshot";
import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canDeleteMotorcycleDocuments,
  canEditWorkOrder,
  canUpdateServiceInformation,
  canUploadMotorcycleDocuments,
  canViewBillingArea,
  canViewClients,
  canViewMotorcycleDocuments,
} from "@/lib/permissions";
import { MotorcycleForm } from "@/components/forms/MotorcycleForm";
import { ServiceInformationForm } from "@/components/forms/ServiceInformationForm";
import { TransferMotorcycleForm } from "@/components/forms/TransferMotorcycleForm";
import { OutstandingRecommendations } from "@/components/recommendations/OutstandingRecommendations";
import { StaffPhotoGrid } from "@/components/photos/StaffPhotoGrid";
import { MotorcycleDocuments } from "@/components/motorcycles/MotorcycleDocuments";
import { MotorcycleVisitList } from "@/components/motorcycles/MotorcycleVisitList";
import {
  updateMotorcycleAction,
  updateServiceInformationAction,
  transferMotorcycleAction,
} from "@/app/(app)/motorcycles/actions";
import { listMotorcycleDocuments } from "@/lib/services/motorcycleDocuments";
import { formatDate, formatDateTime } from "@/lib/datetime/format";
import { formatMileage, normalizeMileageUnit } from "@/lib/mileage/format";

function formatMoneyCents(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function MotorcycleDetailPage({
  params,
}: {
  params: Promise<{ motorcycle_id: string }>;
}) {
  const { motorcycle_id } = await params;
  const user = await requireUser();
  const preview = await getRolePreviewContext();
  const viewRole = preview?.role ?? user.role;
  if (!canViewClients(viewRole)) redirect("/dashboard");
  const motorcycle = await getMotorcycleById(motorcycle_id);
  if (!motorcycle) notFound();

  const canViewDocs = canViewMotorcycleDocuments(viewRole);
  const [
    serviceInformation,
    customers,
    outstandingRecommendations,
    visits,
    photos,
    documents,
  ] = await Promise.all([
    getServiceInformation(motorcycle_id),
    searchCustomers("", { preferShopCustomers: true }),
    listOutstandingRecommendationsForMotorcycle(motorcycle_id),
    listWorkOrdersForMotorcycle(motorcycle_id),
    listIntakePhotosForMotorcycle(motorcycle_id),
    canViewDocs ? listMotorcycleDocuments(motorcycle_id) : Promise.resolve([]),
  ]);

  let customerOptions = customers;
  if (!customers.some((c) => c.customer_id === motorcycle.customer_id)) {
    const owner = await getCustomerById(motorcycle.customer_id);
    if (owner) customerOptions = [owner, ...customers];
  }

  const updateAction = updateMotorcycleAction.bind(null, motorcycle_id);
  const transferAction = transferMotorcycleAction.bind(null, motorcycle_id);
  const serviceInfoAction = updateServiceInformationAction.bind(
    null,
    motorcycle_id,
    null
  );
  const canEditServiceInfo = canUpdateServiceInformation(viewRole);
  const canTransfer = canEditWorkOrder(viewRole);
  const showMoney = canViewBillingArea(viewRole);
  const canUploadDocs = canUploadMotorcycleDocuments(viewRole);
  const canDeleteDocs = canDeleteMotorcycleDocuments(viewRole);
  const ownerName = motorcycle.customer
    ? `${motorcycle.customer.first_name} ${motorcycle.customer.last_name}`
    : "Unknown";
  const bikeLabel = `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`;

  const allVisits = [...visits.open, ...visits.filed];
  const snapshot = buildBikeSnapshot(allVisits);
  const lastMileageVisit = allVisits
    .filter((visit) => visit.mileage != null)
    .sort((a, b) => {
      const aKey = a.completed_at ?? a.date_created;
      const bKey = b.completed_at ?? b.date_created;
      return bKey.localeCompare(aKey);
    })[0];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/motorcycles"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Motorcycles
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {bikeLabel}
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Owner:{" "}
          <Link
            href={`/customers/${motorcycle.customer_id}`}
            className="underline-offset-2 hover:underline"
          >
            {ownerName}
          </Link>
          {motorcycle.colour ? ` · ${motorcycle.colour}` : null}
          {motorcycle.plate_number ? ` · Plate ${motorcycle.plate_number}` : null}
          {motorcycle.vin ? ` · VIN ${motorcycle.vin}` : null}
          {canTransfer ? (
            <>
              {" · "}
              <a
                href="#transfer-ownership"
                className="font-semibold text-foreground underline-offset-2 hover:underline"
              >
                Transfer
              </a>
            </>
          ) : null}
        </p>
      </div>

      {motorcycle.vin ? null : (
        <p
          role="status"
          className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
        >
          Missing VIN — add the VIN before releasing this motorcycle.
        </p>
      )}

      <section aria-label="Bike snapshot">
        <h2 className="text-lg font-semibold text-foreground">At a glance</h2>
        <div className="bike-snapshot-grid mt-3">
          <div className="stat-card">
            <span className="stat-card-label">Visits</span>
            <span className="stat-card-value">{snapshot.visit_count}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">Last visit</span>
            <span className="stat-card-value text-base">
              {snapshot.last_visit_at ? formatDate(snapshot.last_visit_at) || "—" : "—"}
            </span>
            {snapshot.days_since_last_visit != null ? (
              <span className="mt-1 text-xs text-[var(--status-neutral)]">
                {snapshot.days_since_last_visit} day
                {snapshot.days_since_last_visit === 1 ? "" : "s"} ago
              </span>
            ) : null}
          </div>
          <div className="stat-card">
            <span className="stat-card-label">Last mileage</span>
            <span className="stat-card-value text-base">
              {lastMileageVisit?.mileage != null
                ? formatMileage(
                    lastMileageVisit.mileage,
                    normalizeMileageUnit(lastMileageVisit.mileage_unit)
                  )
                : "—"}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">Pending follow-ups</span>
            <span className="stat-card-value">{outstandingRecommendations.length}</span>
          </div>
          {showMoney ? (
            <div className="stat-card">
              <span className="stat-card-label">Lifetime collected</span>
              <span className="stat-card-value text-base">
                {formatMoneyCents(snapshot.lifetime_collected_cents)}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {canViewDocs ? (
        <MotorcycleDocuments
          motorcycleId={motorcycle_id}
          documents={documents}
          canUpload={canUploadDocs}
          canDelete={canDeleteDocs}
        />
      ) : null}

      <section>
        <h2 className="text-lg font-semibold text-foreground">Visit photos</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Every intake, inspection, and after shot from this bike&apos;s visits.
        </p>
        <div className="mt-3">
          <StaffPhotoGrid
            photos={photos}
            mode="bike"
            emptyMessage="Photos appear when a visit has intake, inspection, or after shots."
          />
        </div>
      </section>

      <OutstandingRecommendations
        recommendations={outstandingRecommendations}
        title="Pending recommendations"
      />

      <section>
        <h2 className="text-lg font-semibold text-foreground">Open visits</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Active work for this motorcycle across shops you can see.
        </p>
        <MotorcycleVisitList
          items={visits.open}
          emptyMessage="No open visits for this motorcycle."
          showMoney={showMoney}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Previous services</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Completed visits with jobs, mileage, and collected amount.
        </p>
        <MotorcycleVisitList
          items={visits.filed}
          emptyMessage="No completed visits filed for this motorcycle yet."
          showCompletedDate
          showMoney={showMoney}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Service information</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          {serviceInformation?.last_updated
            ? `Last updated ${formatDateTime(serviceInformation.last_updated)}`
            : "Not recorded yet."}
          {" · "}
          Part numbers fill from fitment for blank fields and stay in sync with the
          catalogue.
        </p>
        <div className="mt-3">
          <ServiceInformationForm
            action={serviceInfoAction}
            serviceInformation={serviceInformation}
            canEdit={canEditServiceInfo}
          />
        </div>
      </section>

      <section id="edit-motorcycle">
        <h2 className="text-lg font-semibold text-foreground">Edit motorcycle</h2>
        <div className="mt-3">
          <MotorcycleForm
            action={updateAction}
            customers={customerOptions}
            motorcycle={motorcycle}
            submitLabel="Save changes"
          />
        </div>
      </section>

      {canTransfer ? (
        <section id="transfer-ownership">
          <h2 className="text-lg font-semibold text-foreground">Transfer ownership</h2>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Use when this bike is sold to a different customer.
          </p>
          <div className="mt-3">
            <TransferMotorcycleForm
              action={transferAction}
              customers={customerOptions}
              currentCustomerId={motorcycle.customer_id}
              currentCustomerName={ownerName}
              bikeLabel={bikeLabel}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
