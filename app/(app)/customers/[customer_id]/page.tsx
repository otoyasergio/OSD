import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCustomerById } from "@/lib/services/customers";
import { CUSTOMER_ACCOUNT_TYPE_LABELS } from "@/lib/services/customerShared";
import { listGarageForCustomer } from "@/lib/services/clientGarage";
import { listWorkOrdersForCustomer } from "@/lib/services/filedWorkOrders";
import { listCustomerDocuments } from "@/lib/services/customerDocuments";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { ClientGarage } from "@/components/customers/ClientGarage";
import { CustomerDocuments } from "@/components/customers/CustomerDocuments";
import { CustomerInformationReminder } from "@/components/customers/CustomerInformationReminder";
import { WixCustomerSyncPanel } from "@/components/customers/WixCustomerSyncPanel";
import { updateCustomerAction } from "@/app/(app)/customers/actions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { JOB_STATUS_LABELS } from "@/lib/status/labels";
import type { CustomerWorkOrderSummary } from "@/lib/services/filedWorkOrders";
import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import {
  canDeleteCustomerDocuments,
  canEditWorkOrder,
  canManageCustomerPhotos,
  canSyncWixContacts,
  canUploadCustomerDocuments,
  canUseShopPhone,
  canViewClients,
  canViewCustomerDocuments,
} from "@/lib/permissions";
import { isWixSyncAvailable } from "@/lib/services/wixContacts";
import { formatCalendarDate, formatDate } from "@/lib/datetime/format";
import { ClickToCallButton } from "@/components/comms/ClickToCallButton";
import { CustomerAtAGlance } from "@/components/customers/CustomerAtAGlance";
import { CustomerPhotoForm } from "@/components/customers/CustomerPhotoForm";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { summarizeCustomerVisits } from "@/lib/customers/glance";
import { WixInvoiceList } from "@/components/billing/WixInvoiceList";
import { listInvoicesForCustomer } from "@/lib/services/wixInvoices";
import { readPrivateLicence } from "@/lib/services/customerPrivate";
import { wixInvoicesEnabled } from "@/lib/config/features";
import { signCustomerPhotoForViewer } from "@/lib/services/customerPhotos";
import {
  removeCustomerPhotoAction,
  uploadCustomerPhotoAction,
} from "@/app/(app)/customers/photo-actions";

function WorkOrderHistoryList({
  items,
  emptyMessage,
  showCompletedDate = false,
}: {
  items: CustomerWorkOrderSummary[];
  emptyMessage: string;
  showCompletedDate?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="mt-3 rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-sm text-[var(--status-neutral)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
      {items.map((wo) => {
        const jobSummary =
          wo.jobs.length === 0
            ? "No jobs"
            : wo.jobs
                .map(
                  (job) =>
                    `${job.service_name_snapshot} (${JOB_STATUS_LABELS[job.status] ?? job.status})`
                )
                .join(", ");

        return (
          <li key={wo.work_order_id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link
                  href={`/work_orders/${wo.work_order_id}`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {wo.work_order_number}
                </Link>
                <p className="mt-0.5 text-sm text-[var(--status-neutral)]">
                  {wo.motorcycle_label}
                  {" · "}
                  {wo.location_name}
                  {wo.location_code ? ` (${wo.location_code})` : null}
                </p>
                <p className="mt-1 text-xs text-[var(--status-neutral)]">{jobSummary}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={wo.status} />
                <span className="text-xs text-[var(--status-neutral)]">
                  {showCompletedDate
                    ? `Completed ${formatDate(wo.completed_at) || "—"}`
                    : `Opened ${formatDate(wo.date_created) || "—"}`}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customer_id: string }>;
}) {
  const { customer_id } = await params;
  const user = await requireUser();
  const preview = await getRolePreviewContext();
  const viewRole = preview?.role ?? user.role;
  if (!canViewClients(viewRole)) redirect("/dashboard");
  const customer = await getCustomerById(customer_id);
  if (!customer) notFound();

  const [garage, history, documents, invoices, licence] = await Promise.all([
    listGarageForCustomer(customer_id),
    listWorkOrdersForCustomer(customer_id),
    canViewCustomerDocuments(viewRole)
      ? listCustomerDocuments(customer_id)
      : Promise.resolve([]),
    wixInvoicesEnabled() ? listInvoicesForCustomer(customer_id) : Promise.resolve([]),
    readPrivateLicence(customer_id),
  ]);
  const updateAction = updateCustomerAction.bind(null, customer_id);
  const uploadPhotoAction = uploadCustomerPhotoAction.bind(null, customer_id);
  const removePhotoAction = removeCustomerPhotoAction.bind(null, customer_id);
  const canEditPhoto = canManageCustomerPhotos(viewRole);
  const photoUrl = await signCustomerPhotoForViewer(customer.photo_path);
  const glance = summarizeCustomerVisits([...history.open, ...history.filed]);
  const canTransfer = canEditWorkOrder(viewRole);
  const canUploadDocs = canUploadCustomerDocuments(viewRole);
  const canDeleteDocs = canDeleteCustomerDocuments(viewRole);
  const canViewDocs = canViewCustomerDocuments(viewRole);
  const canSyncWix = canSyncWixContacts(viewRole);
  const wixConfigured = isWixSyncAvailable();

  return (
    <div className="page-stack page-stack--narrow">
      <div>
        <Link
          href="/customers"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Customers
        </Link>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
          {canEditPhoto ? (
            <CustomerPhotoForm
              firstName={customer.first_name}
              lastName={customer.last_name}
              photoUrl={photoUrl}
              uploadAction={uploadPhotoAction}
              removeAction={removePhotoAction}
            />
          ) : (
            <UserAvatar
              firstName={customer.first_name}
              lastName={customer.last_name}
              photoUrl={photoUrl}
              size="lg"
              className="ring-1 ring-[var(--border)]"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {customer.first_name} {customer.last_name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--status-neutral)]">
              <span className="badge mr-2 bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]">
                {CUSTOMER_ACCOUNT_TYPE_LABELS[customer.account_type] ?? "Retail"}
              </span>
              {customer.phone ?? "No phone"} · {customer.email ?? "No email"}
              <ClickToCallButton
                phone={customer.phone}
                customerId={customer.customer_id}
                customerName={`${customer.first_name} ${customer.last_name}`.trim()}
                visible={canUseShopPhone(viewRole)}
              />
            </p>
            {customer.address || customer.date_of_birth ? (
              <p className="mt-1 text-sm text-[var(--status-neutral)]">
                {customer.address ?? "No address"}
                {customer.date_of_birth
                  ? ` · Birthday ${formatCalendarDate(customer.date_of_birth)}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <CustomerAtAGlance
        createdAt={customer.created_at}
        glance={glance}
        smsOptedOutAt={customer.sms_opted_out_at}
      />

      {licence?.licence_number ? (
        <p className="text-sm text-[var(--status-neutral)]">
          Licence {licence.licence_number}
          {licence.licence_expiry ? ` · expires ${licence.licence_expiry}` : ""}
        </p>
      ) : null}

      {wixInvoicesEnabled() ? (
        <section>
          <h2 className="text-lg font-semibold">Wix invoices</h2>
          <WixInvoiceList
            invoices={invoices}
            emptyLabel="No Wix invoices for this customer yet."
          />
        </section>
      ) : null}

      <CustomerInformationReminder
        phone={customer.phone}
        email={customer.email}
        address={customer.address}
        dateOfBirth={customer.date_of_birth}
        editHref="#edit-customer"
      />

      <WixCustomerSyncPanel
        customerId={customer_id}
        wixContactId={customer.wix_contact_id}
        configured={wixConfigured}
        canSync={canSyncWix}
      />

      <ClientGarage customerId={customer_id} bikes={garage} canTransfer={canTransfer} />

      {canViewDocs ? (
        <CustomerDocuments
          customerId={customer_id}
          documents={documents}
          canUpload={canUploadDocs}
          canDelete={canDeleteDocs}
        />
      ) : null}

      <section>
        <h2 className="text-lg font-semibold text-foreground">Open work orders</h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Active visits across all locations.
        </p>
        <WorkOrderHistoryList
          items={history.open}
          emptyMessage="No open work orders for this customer."
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">
          Completed / filed work orders
        </h2>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Released visits (status Completed), with jobs from each work order. Browse all
          filed work at this location in{" "}
          <Link href="/complete" className="underline-offset-2 hover:underline">
            Complete and filed
          </Link>
          .
        </p>
        <WorkOrderHistoryList
          items={history.filed}
          emptyMessage="No completed work orders filed for this customer yet."
          showCompletedDate
        />
      </section>

      {customer.notes?.trim() ? (
        <section>
          <h2 className="text-lg font-semibold text-foreground">Notes</h2>
          <p className="mt-3 whitespace-pre-wrap rounded border border-[var(--border)] bg-white px-4 py-3 text-sm text-foreground">
            {customer.notes}
          </p>
        </section>
      ) : null}

      <section id="edit-customer" className="scroll-mt-6">
        <h2 className="text-lg font-semibold text-foreground">Edit customer</h2>
        <div className="mt-3">
          <CustomerForm
            action={updateAction}
            customer={customer}
            submitLabel="Save changes"
          />
        </div>
      </section>
    </div>
  );
}
