import type { WorkOrderStatus } from "@/lib/database/types";
import {
  VISIT_PIPELINE_STAGES,
  getPipelineStageIndex,
} from "@/lib/status/pipeline";

export function WorkOrderPipeline({ status }: { status: WorkOrderStatus }) {
  const activeIndex = getPipelineStageIndex(status);
  const isCancelled = status === "cancelled";
  const isOnHold = status === "on_hold";

  return (
    <nav
      className="wo-pipeline"
      aria-label="Visit progress"
    >
      <ol className="wo-pipeline-track">
        {VISIT_PIPELINE_STAGES.map((stage, index) => {
          let state: "complete" | "current" | "upcoming" | "muted" = "upcoming";

          if (isCancelled || isOnHold) {
            state = "muted";
          } else if (index < activeIndex) {
            state = "complete";
          } else if (index === activeIndex) {
            state = "current";
          }

          return (
            <li
              key={stage.id}
              className={`wo-pipeline-step wo-pipeline-step-${state}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className="wo-pipeline-dot" aria-hidden />
              <span className="wo-pipeline-label">{stage.shortLabel}</span>
            </li>
          );
        })}
      </ol>
      {isOnHold ? (
        <p className="wo-pipeline-note">On hold — pipeline paused</p>
      ) : null}
      {isCancelled ? (
        <p className="wo-pipeline-note wo-pipeline-note-danger">Cancelled</p>
      ) : null}
    </nav>
  );
}
