import Link from "next/link";
import {
  CONTROL_CENTER_COHORTS,
  type ControlCenterCohortKey,
} from "@/lib/control-center/cohorts";
import type { ControlCenterBike } from "@/lib/services/controlCenter";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StageChip } from "@/components/ui/StageChip";

export function ControlCenterCohortView({
  cohort,
  bikes,
}: {
  cohort: ControlCenterCohortKey;
  bikes: ControlCenterBike[];
}) {
  const meta = CONTROL_CENTER_COHORTS[cohort];

  return (
    <div className="page-stack page-stack--wide" style={{ gap: "1.25rem" }}>
      <PageHeader
        title={meta.title}
        subtitle={meta.description}
        actions={
          <Link href="/control-center" className="btn btn-secondary">
            Back to Control Center
          </Link>
        }
      />

      {bikes.length === 0 ? (
        <EmptyState
          variant="work-orders"
          title="No bikes in this list"
          description={`Nothing matches “${meta.title}” right now.`}
          action={{ href: "/control-center", label: "Back to Control Center" }}
        />
      ) : (
        <section className="cc-cohort-list" aria-label={`${meta.title} bikes`}>
          <div className="cc-cohort-list-header">
            <h2 className="cc-pool-title">{meta.title}</h2>
            <span className="shop-board-column-count">{bikes.length}</span>
          </div>
          <ul className="cc-cohort-rows">
            {bikes.map((bike) => (
              <li key={bike.work_order_id}>
                <Link
                  href={`/work_orders/${bike.work_order_id}`}
                  className="cc-cohort-row"
                >
                  <div className="cc-cohort-row-main">
                    <p className="cc-bike-title">{bike.bike_title}</p>
                    <p className="cc-bike-subtitle">
                      {bike.customer_name} · {bike.work_order_number}
                    </p>
                  </div>
                  <StageChip label={bike.stage_label} tone={bike.stage_tone} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
