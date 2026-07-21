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
import { techJobPacketHref } from "@/lib/technician/assignmentHref";
import {
  parseTechnicianRouteState,
  type TechnicianRouteParams,
} from "@/lib/technician/routeState";
import type { FloorStage } from "@/lib/technician/floorStage";

export const dynamic = "force-dynamic";

function modeForFetch(stage: FloorStage | null): FloorOsMode {
  if (stage === "inspect") return "inspection";
  if (stage === "qc") return "qc";
  if (stage === "safety") return "safety";
  return "job";
}

export default async function TechnicianPage({
  searchParams,
}: {
  searchParams: Promise<TechnicianRouteParams>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const route = parseTechnicianRouteState(params);

  const hasSelection = Boolean(route.jobId || route.workOrderId);
  // Always load intake/proof photos with the packet so techs can open them
  // any time the bike is on their docket — no second "Load photos" hop.
  const loadPacket = route.panel === "packet" && Boolean(route.workOrderId);

  const [floor, docket, readyForPickup, packet, packetPhotos] = await Promise.all([
    hasSelection
      ? getTechnicianFloorOs({
          jobId: route.jobId,
          workOrderId: route.workOrderId,
          mode: modeForFetch(route.stage),
        })
      : Promise.resolve(emptyFloorOs()),
    isFloorTech(user.role)
      ? getTechnicianDocket(user.user_id).catch(() => null)
      : Promise.resolve(null),
    // Pickup queue is front-office only — floor techs stay on their docket.
    isFloorTech(user.role)
      ? Promise.resolve([])
      : listReadyForPickup({ hrefFor: (id) => techJobPacketHref(id) }).catch(() => []),
    loadPacket
      ? getJobPacket(route.workOrderId!).catch(() => null)
      : Promise.resolve(null),
    loadPacket
      ? listIntakePhotos(route.workOrderId!).catch(() => [])
      : Promise.resolve([]),
  ]);

  // Explicit stage only — the shell derives the default per surface, so URLs
  // never pin a stage the tech didn't choose.
  return (
    <TechnicianFloorShell
      floor={floor}
      stage={route.stage ?? undefined}
      viewerUserId={user.user_id}
      docketItems={docket?.items ?? []}
      readyForPickup={readyForPickup}
      panel={route.panel}
      packet={packet}
      packetSection={route.packetSection}
      packetPhotos={packetPhotos}
      packetWorkOrderId={route.workOrderId}
      packetJobId={route.jobId}
    />
  );
}
