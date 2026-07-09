import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageServiceCatalogue } from "@/lib/permissions";
import { listServices } from "@/lib/services/serviceCatalogue";
import {
  ServiceCreateForm,
  ServiceEditForm,
} from "@/components/forms/ServiceForms";
import {
  createServiceAction,
  updateServiceAction,
  toggleServiceActiveAction,
} from "@/app/(app)/settings/services/actions";

export const dynamic = "force-dynamic";

function formatNumber(value: number | null, suffix = "") {
  if (value === null) return "—";
  return `${value}${suffix}`;
}

export default async function ServiceCataloguePage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageServiceCatalogue(user.role)) redirect("/dashboard");

  const services = await listServices({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Service catalogue
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Deactivated services stay on historical jobs. Services are never deleted.
        </p>
      </div>

      <ServiceCreateForm action={createServiceAction} />

      <div className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
        {services.map((service) => (
          <details key={service.service_id} className="px-4 py-3">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
              <span className="font-medium text-zinc-900">
                {service.name}
                {service.active ? null : (
                  <span className="ml-2 rounded bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                    Inactive
                  </span>
                )}
              </span>
              <span className="text-sm text-zinc-600">
                {formatNumber(service.standard_price)} ·{" "}
                {formatNumber(service.estimated_labour, " h")}
              </span>
            </summary>

            <ServiceEditForm
              action={updateServiceAction.bind(null, service.service_id)}
              service={service}
            />

            <form
              action={toggleServiceActiveAction.bind(
                null,
                service.service_id,
                !service.active
              )}
              className="pt-3"
            >
              <button
                type="submit"
                className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
              >
                {service.active ? "Deactivate service" : "Reactivate service"}
              </button>
            </form>
          </details>
        ))}
      </div>
    </div>
  );
}
