import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getTechnicianDashboard } from "@/lib/services/technician";
import {
  canCompleteWorkOrder,
  canRecordCustomerApproval,
} from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function TechnicianPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const dashboard = await getTechnicianDashboard();
  const canApprove = canRecordCustomerApproval(user.role);
  const canCompleteWo = canCompleteWorkOrder(user.role);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Technician
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Assigned work at the active location for{" "}
          {user.first_name} {user.last_name}.
        </p>
        {!canApprove && !canCompleteWo ? (
          <p className="mt-2 text-sm text-zinc-500">
            Approval and work-order completion actions are not available on this
            view.
          </p>
        ) : null}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">My jobs</h2>
        {dashboard.myJobs.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-zinc-600">
            No active jobs assigned to you at this location.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            {dashboard.myJobs.map((job) => (
              <li key={job.job_id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-900">
                      {job.service_name_snapshot}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {job.work_order_number} · {job.customer_label} ·{" "}
                      {job.motorcycle_label}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Job: {job.status_label} · WO: {job.work_order_status_label}
                    </p>
                  </div>
                  <Link
                    href={job.href}
                    className="inline-flex min-h-11 items-center rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
                  >
                    Open jobs
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-zinc-900">
          Assigned work orders
        </h2>
        {dashboard.workOrders.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-zinc-600">
            No work orders assigned to you at this location.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            {dashboard.workOrders.map((wo) => (
              <li key={wo.work_order_id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-900">
                      {wo.work_order_number}
                      {wo.is_primary ? (
                        <span className="ml-2 rounded bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                          Primary
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {wo.customer_label} · {wo.motorcycle_label}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {wo.status_label}
                      {wo.inspection_complete
                        ? " · Inspection complete"
                        : " · Inspection open"}
                    </p>
                    {wo.jobs.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                        {wo.jobs.map((job) => (
                          <li key={job.job_id}>
                            {job.service_name_snapshot} — {job.status_label}
                            {job.assigned_to_me ? " (you)" : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={wo.inspection_href}
                      className="inline-flex min-h-11 items-center rounded border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    >
                      Inspection
                    </Link>
                    <Link
                      href={wo.jobs_href}
                      className="inline-flex min-h-11 items-center rounded border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    >
                      Jobs
                    </Link>
                    <Link
                      href={wo.overview_href}
                      className="inline-flex min-h-11 items-center rounded bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800"
                    >
                      Open
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
