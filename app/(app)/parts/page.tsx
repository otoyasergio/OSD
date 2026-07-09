import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canViewPartsBoard } from "@/lib/permissions";
import { listPartsWaitingForLocation } from "@/lib/services/partsBoard";
import { listTechniciansForActiveLocation } from "@/lib/services/workOrders";
import { PageHeader } from "@/components/ui/PageHeader";
import { PartsWaitingBoard } from "@/components/parts/PartsWaitingBoard";
import { SELECT_CLASS } from "@/components/forms/Field";

export const dynamic = "force-dynamic";

export default async function PartsWaitingPage({
  searchParams,
}: {
  searchParams: Promise<{ technician_id?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewPartsBoard(user.role)) redirect("/dashboard");
  if (!user.active_location_id) redirect("/dashboard");

  const params = await searchParams;
  const technicianId = params.technician_id?.trim() || "";

  const [items, technicians] = await Promise.all([
    listPartsWaitingForLocation(user.active_location_id, {
      technicianId: technicianId || undefined,
    }),
    listTechniciansForActiveLocation(),
  ]);

  const neededCount = items.filter((item) => item.status === "needed").length;
  const orderedCount = items.filter((item) => item.status === "ordered").length;

  return (
    <div className="page-stack page-stack--wide">
      <PageHeader
        title="Parts waiting"
        subtitle="Needed and ordered parts across open work orders at this location."
      />

      <div className="grid gap-2 sm:grid-cols-3 lg:max-w-2xl">
        <div className="stat-card" aria-label={`${items.length} parts waiting`}>
          <span className="stat-card-label">Waiting</span>
          <span className="stat-card-value">{items.length}</span>
        </div>
        <div className="stat-card" aria-label={`${neededCount} needed`}>
          <span className="stat-card-label">Needed</span>
          <span className="stat-card-value">{neededCount}</span>
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

      <PartsWaitingBoard items={items} />
    </div>
  );
}
