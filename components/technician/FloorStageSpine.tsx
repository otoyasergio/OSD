"use client";

import Link from "next/link";
import { Camera, Check, ClipboardCheck, Wrench } from "lucide-react";
import { technicianFloorHref } from "@/lib/technician/routeState";
import type {
  FloorSpineKey,
  FloorSpineNodeState,
  FloorStage,
} from "@/lib/technician/floorStage";

const NODES: Array<{
  stage: FloorSpineKey;
  label: string;
  Icon: typeof ClipboardCheck;
}> = [
  { stage: "inspect", label: "Inspect", Icon: ClipboardCheck },
  { stage: "work", label: "Work", Icon: Wrench },
  { stage: "proof", label: "Photo", Icon: Camera },
  { stage: "done", label: "Done", Icon: Check },
];

export function FloorStageSpine({
  workOrderId,
  jobId,
  activeStage,
  states,
}: {
  workOrderId: string;
  jobId: string;
  activeStage: FloorStage;
  states: Record<FloorSpineKey, FloorSpineNodeState>;
}) {
  return (
    <nav className="pit-spine" aria-label="Job stages">
      {NODES.map((node, index) => {
        const state = states[node.stage];
        const Icon = node.Icon;
        const tappable = state === "current" || node.stage === "inspect";
        const className = [
          "pit-spine-node",
          `pit-spine-node--${state}`,
          activeStage === node.stage ? "pit-spine-node--active" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const body = (
          <>
            <span className="pit-spine-icon" aria-hidden>
              <Icon size={22} />
            </span>
            <span className="pit-spine-label">{node.label}</span>
          </>
        );
        return (
          <span key={node.stage} className="pit-spine-item">
            {index > 0 ? <span className="pit-spine-join" aria-hidden /> : null}
            {tappable ? (
              <Link
                href={technicianFloorHref({
                  workOrderId,
                  jobId,
                  stage: node.stage,
                })}
                className={className}
                aria-current={activeStage === node.stage ? "step" : undefined}
              >
                {body}
              </Link>
            ) : (
              <span className={className}>{body}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
