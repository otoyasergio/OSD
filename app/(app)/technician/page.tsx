import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getTechnicianDashboard } from "@/lib/services/technician";
import {
  canCompleteWorkOrder,
  canRecordCustomerApproval,
} from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TechnicianJobCard } from "@/components/jobs/TechnicianJobCard";
import { updateJobStatusAction } from "@/app/(app)/work_orders/job-actions";

export const dynamic = "force-dynamic";

export default async function TechnicianPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const dashboard = await getTechnicianDashboard();
  const canApprove = canRecordCustomerApproval(user.role);
  const canCompleteWo = canCompleteWorkOrder(user.role);

  return (
    <div className="page-stack">
      <PageHeader
        title="Technician"
        subtitle={`Assigned work at the active location for ${user.first_name} ${user.last_name}.`}
      />

      {!canApprove && !canCompleteWo ? (
        <p className="text-sm text-[var(--status-neutral)]">
          Approval and work-order completion actions are managed from the work
          order overview tab.
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">My jobs</h2>
        {dashboard.myJobs.length === 0 ? (
          <EmptyState
            title="No active jobs"
            description="Jobs assigned to you will appear here with Start and Complete actions."
            action={{ href: "/dashboard", label: "View shop board" }}
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {dashboard.myJobs.map((job) => {
              const canStart =
                job.status === "approved" || job.status === "ready_to_start";
              const canComplete = job.status === "in_progress";

              return (
                <li key={job.job_id}>
                  <TechnicianJobCard
                    serviceName={job.service_name_snapshot}
                    status={job.status}
                    statusLabel={job.status_label}
                    workOrderNumber={job.work_order_number}
                    customerLabel={job.customer_label}
                    motorcycleLabel={job.motorcycle_label}
                    workOrderStatusLabel={job.work_order_status_label}
                    workOrderHref={job.href}
                    canStart={canStart}
                    canComplete={canComplete}
                    startAction={updateJobStatusAction.bind(
                      null,
                      job.work_order_id,
                      job.job_id
                    )}
                    completeAction={updateJobStatusAction.bind(
                      null,
                      job.work_order_id,
                      job.job_id
                    )}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Assigned work orders
        </h2>
        {dashboard.workOrders.length === 0 ? (
          <EmptyState
            description="Work orders you are assigned to will appear here."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {dashboard.workOrders.map((wo) => (
              <li key={wo.work_order_id} className="card">
                <div className="card-body">
                  <div className="wo-card-hero">
                    <p className="wo-card-bike">{wo.motorcycle_label}</p>
                    <p className="wo-card-customer">{wo.customer_label}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="wo-card-number">{wo.work_order_number}</span>
                    {wo.is_primary ? (
                      <span className="badge bg-[var(--accent-muted)] text-[var(--accent-foreground)]">
                        Primary
                      </span>
                    ) : null}
                    <StatusBadge status={wo.status} />
                  </div>
                  <p className="mt-2 text-sm text-[var(--status-neutral)]">
                    {wo.inspection_complete
                      ? "Inspection complete"
                      : "Inspection open"}
                  </p>
                  {wo.jobs.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-[var(--status-neutral-fg)]">
                      {wo.jobs.map((job) => (
                        <li key={job.job_id}>
                          {job.service_name_snapshot} — {job.status_label}
                          {job.assigned_to_me ? " (you)" : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={wo.inspection_href}
                      className="btn btn-secondary"
                    >
                      Inspection
                    </Link>
                    <Link href={wo.jobs_href} className="btn btn-secondary">
                      Jobs
                    </Link>
                    <Link href={wo.overview_href} className="btn btn-primary">
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
