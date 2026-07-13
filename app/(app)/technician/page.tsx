import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getOpenTimeClockEntry } from "@/lib/services/timeClock";
import { getTechnicianFloorOs, type FloorOsMode } from "@/lib/services/technicianFloor";
import { getTechnicianDocket } from "@/lib/services/technicianDocket";
import { isFloorTech } from "@/lib/permissions";
import {
  TechnicianFloorShell,
  deriveDefaultStage,
  type FloorStage,
} from "@/components/technician/TechnicianFloorShell";

export const dynamic = "force-dynamic";

const STAGES = new Set<FloorStage>(["inspect", "work", "proof", "done", "qc", "safety"]);

function stageFromParams(params: { stage?: string; mode?: string }): FloorStage | null {
  if (params.stage && STAGES.has(params.stage as FloorStage)) {
    return params.stage as FloorStage;
  }
  // Legacy mode → stage mapping
  switch (params.mode) {
    case "inspection":
      return "inspect";
    case "parts":
    case "job":
      return "work";
    case "qc":
      return "qc";
    case "safety":
      return "safety";
    case "notes":
      return "done";
    default:
      return null;
  }
}

function modeForFetch(stage: FloorStage | null): FloorOsMode {
  if (stage === "inspect") return "inspection";
  if (stage === "qc") return "qc";
  if (stage === "safety") return "safety";
  return "job";
}

export default async function TechnicianPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; wo?: string; mode?: string; stage?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const requestedStage = stageFromParams(params);

  const [floor, openClock, docket] = await Promise.all([
    getTechnicianFloorOs({
      jobId: params.job ?? null,
      workOrderId: params.wo ?? null,
      mode: modeForFetch(requestedStage),
    }),
    getOpenTimeClockEntry(user.user_id),
    isFloorTech(user.role)
      ? getTechnicianDocket(user.user_id).catch(() => null)
      : Promise.resolve(null),
  ]);

  const stage =
    requestedStage ?? (floor.selected ? deriveDefaultStage(floor.selected) : "work");

  return (
    <TechnicianFloorShell
      floor={floor}
      openClock={openClock}
      stage={stage}
      docketItems={docket?.items ?? []}
    />
  );
}
