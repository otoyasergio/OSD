import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canManageServiceCatalogue } from "@/lib/permissions";
import {
  groupServicesByCategory,
  listActiveServiceVersions,
  listServices,
} from "@/lib/services/serviceCatalogue";
import { ServiceCreateForm, ServiceEditForm } from "@/components/forms/ServiceForms";
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
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canManageServiceCatalogue(preview.role)) redirect("/dashboard");

  const [services, activeVersions] = await Promise.all([
    listServices({ includeInactive: true }),
    listActiveServiceVersions(),
  ]);
  const grouped = groupServicesByCategory(services);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Service catalogue
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Deactivated services stay on historical jobs. Services are never deleted.
        </p>
      </div>

      <ServiceCreateForm action={createServiceAction} />

      <div className="flex flex-col gap-6">
        {grouped.map(({ category, services: categoryServices }) => (
          <section key={category}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
              {category}
            </h2>
            <div className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
              {categoryServices.map((service) => (
                <details key={service.service_id} className="px-4 py-3">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                    <span className="font-medium text-foreground">
                      {service.name}
                      {service.active ? null : (
                        <span className="ml-2 rounded bg-[var(--border)] px-2 py-0.5 text-xs font-semibold text-foreground">
                          Inactive
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-[var(--status-neutral)]">
                      {formatNumber(service.standard_price)} ·{" "}
                      {formatNumber(service.estimated_labour, " h")}
                    </span>
                  </summary>

                  <ServiceEditForm
                    action={updateServiceAction.bind(null, service.service_id)}
                    service={service}
                    pricingMode={
                      activeVersions.get(service.service_id)?.pricing_mode ??
                      "fixed_package"
                    }
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
                      className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-[var(--surface-muted)]"
                    >
                      {service.active ? "Deactivate service" : "Reactivate service"}
                    </button>
                  </form>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
