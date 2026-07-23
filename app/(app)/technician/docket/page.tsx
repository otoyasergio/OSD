import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canAssignTechnician } from "@/lib/permissions";
import { listTechniciansForActiveLocation } from "@/lib/services/workOrders";
import {
  getTechnicianDocket,
  resolveDefaultDocketTechnicianId,
} from "@/lib/services/technicianDocket";
import { TechnicianDocketList } from "@/components/technician/TechnicianDocketList";
import { reorderDocketJobAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function TechnicianDocketPage({
  searchParams,
}: {
  searchParams: Promise<{ tech?: string }>;
}) {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canAssignTechnician(preview.role)) redirect("/technician");

  const params = await searchParams;
  const technicians = await listTechniciansForActiveLocation();
  const techIds = technicians.map((t) => t.user_id);

  let selectedTechId = params.tech ?? null;
  if (!selectedTechId || !techIds.includes(selectedTechId)) {
    selectedTechId = await resolveDefaultDocketTechnicianId(techIds);
  }

  const docket =
    selectedTechId != null
      ? await getTechnicianDocket(selectedTechId).catch(() => null)
      : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Tech docket</h1>
        <p className="text-sm text-[var(--status-neutral)]">
          Ordered what&apos;s next for one technician&apos;s job load.
        </p>
      </header>

      {technicians.length === 0 ? (
        <p className="text-sm text-[var(--status-neutral)]">
          No technicians at this location.
        </p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Technician</span>
              <select
                name="tech"
                defaultValue={selectedTechId ?? ""}
                className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]"
              >
                {technicians.map((tech) => (
                  <option key={tech.user_id} value={tech.user_id}>
                    {tech.first_name} {tech.last_name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary min-h-11">
              Show docket
            </button>
          </form>

          {docket ? (
            <section className="rounded border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {docket.technician.first_name} {docket.technician.last_name}
                </h2>
                <p className="text-sm text-[var(--status-neutral)]">
                  {docket.items.length} item{docket.items.length === 1 ? "" : "s"}
                </p>
              </div>
              <TechnicianDocketList
                items={docket.items}
                linkMode="overview"
                reorderAction={reorderDocketJobAction}
              />
              <p className="mt-4 text-sm text-[var(--status-neutral)]">
                <Link href="/technician" className="underline">
                  Open Tech floor
                </Link>
              </p>
            </section>
          ) : (
            <p className="text-sm text-[var(--status-neutral)]">
              Could not load that technician&apos;s docket.
            </p>
          )}
        </>
      )}
    </div>
  );
}
