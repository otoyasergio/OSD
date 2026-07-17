import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  emptyFloorOs,
  getTechnicianFloorOs,
  type FloorOsMode,
} from "@/lib/services/technicianFloor";
import { getTechnicianDocket } from "@/lib/services/technicianDocket";
import { listReadyForPickup } from "@/lib/services/readyForPickup";
import { getJobPacket } from "@/lib/services/jobPacket";
import { listIntakePhotos } from "@/lib/services/photos";
import { isFloorTech } from "@/lib/permissions";
import { TechnicianFloorShell } from "@/components/technician/TechnicianFloorShell";
import {
  techJobPacketHref,
  type JobPacketSection,
} from "@/lib/technician/assignmentHref";
import { deriveDefaultStage, type FloorStage } from "@/lib/technician/floorStage";

export const dynamic = "force-dynamic";

const STAGES = new Set<FloorStage>(["inspect", "work", "proof", "done", "qc", "safety"]);
const PACKET_SECTIONS = new Set<JobPacketSection>(["notes", "photos", "jobs"]);

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

function packetSectionFromParams(value: string | undefined): JobPacketSection | null {
  if (value && PACKET_SECTIONS.has(value as JobPacketSection)) {
    return value as JobPacketSection;
  }
  return null;
}

export default async function TechnicianPage({
  searchParams,
}: {
  searchParams: Promise<{
    job?: string;
    wo?: string;
    mode?: string;
    stage?: string;
    panel?: string;
    packetSection?: string;
  }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const requestedStage = stageFromParams(params);
  const panel = params.panel === "packet" ? "packet" : null;
  const packetSection = packetSectionFromParams(params.packetSection);

  const hasSelection = Boolean(params.job || params.wo);
  const loadPhotos =
    panel === "packet" && packetSection === "photos" && Boolean(params.wo);

  const [floor, docket, readyForPickup, packet, packetPhotos] = await Promise.all([
    hasSelection
      ? getTechnicianFloorOs({
          jobId: params.job ?? null,
          workOrderId: params.wo ?? null,
          mode: modeForFetch(requestedStage),
        })
      : Promise.resolve(emptyFloorOs()),
    isFloorTech(user.role)
      ? getTechnicianDocket(user.user_id).catch(() => null)
      : Promise.resolve(null),
    listReadyForPickup({ hrefFor: (id) => techJobPacketHref(id) }).catch(() => []),
    panel === "packet" && params.wo
      ? getJobPacket(params.wo).catch(() => null)
      : Promise.resolve(null),
    loadPhotos && params.wo
      ? listIntakePhotos(params.wo).catch(() => [])
      : Promise.resolve([]),
  ]);

  const stage =
    requestedStage ?? (floor.selected ? deriveDefaultStage(floor.selected) : "work");

  return (
    <TechnicianFloorShell
      floor={floor}
      stage={stage}
      docketItems={docket?.items ?? []}
      readyForPickup={readyForPickup}
      panel={panel}
      packet={packet}
      packetSection={packetSection}
      packetPhotos={packetPhotos}
      packetWorkOrderId={params.wo ?? null}
      packetJobId={params.job ?? null}
    />
  );
}
