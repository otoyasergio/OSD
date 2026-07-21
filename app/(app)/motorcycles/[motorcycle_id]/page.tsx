import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMotorcycleById, getServiceInformation } from "@/lib/services/motorcycles";
import { getCustomerById, searchCustomers } from "@/lib/services/customers";
import { listOutstandingRecommendationsForMotorcycle } from "@/lib/services/recommendations";
import { requireUser } from "@/lib/auth/session";
import {
  canEditWorkOrder,
  canUpdateServiceInformation,
  canViewClients,
} from "@/lib/permissions";
import { MotorcycleForm } from "@/components/forms/MotorcycleForm";
import { ServiceInformationForm } from "@/components/forms/ServiceInformationForm";
import { TransferMotorcycleForm } from "@/components/forms/TransferMotorcycleForm";
import { OutstandingRecommendations } from "@/components/recommendations/OutstandingRecommendations";
import {
  updateMotorcycleAction,
  updateServiceInformationAction,
  transferMotorcycleAction,
} from "@/app/(app)/motorcycles/actions";
import { formatDateTime } from "@/lib/datetime/format";

export default async function MotorcycleDetailPage({
  params,
}: {
  params: Promise<{ motorcycle_id: string }>;
}) {
  const { motorcycle_id } = await params;
  const user = await requireUser();
  if (!canViewClients(user.role)) redirect("/dashboard");
  const motorcycle = await getMotorcycleById(motorcycle_id);
  if (!motorcycle) notFound();

  const [serviceInformation, customers, outstandingRecommendations] = await Promise.all([
    getServiceInformation(motorcycle_id),
    searchCustomers(""),
    listOutstandingRecommendationsForMotorcycle(motorcycle_id),
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
  const canEditServiceInfo = canUpdateServiceInformation(user.role);
  const canTransfer = canEditWorkOrder(user.role);
  const ownerName = motorcycle.customer
    ? `${motorcycle.customer.first_name} ${motorcycle.customer.last_name}`
    : "Unknown";
  const bikeLabel = `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`;

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
          {` · Odometer ${motorcycle.odometer_unit}`}
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

      <OutstandingRecommendations
        recommendations={outstandingRecommendations}
        title="Follow-up from previous visits"
      />

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
