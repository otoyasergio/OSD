import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import type { ReadView } from "@/lib/auth/role-preview-shared";
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
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  const { actor: user, role: viewRole } = preview;
  // Owner previewing Tech mirrors the selected technician's floor read-only;
  // every other visitor stays their own subject.
  const techPreview = preview.isPreviewing && viewRole === "technician";
  const view: ReadView | undefined = techPreview
    ? { role: viewRole, subjectUserId: preview.subjectUserId }
    : undefined;
  const subjectUserId = techPreview ? preview.subjectUserId : user.user_id;

  const params = await searchParams;
  const route = parseTechnicianRouteState(params);

  const hasSelection = Boolean(route.jobId || route.workOrderId);
  // Always load intake/proof photos with the packet so techs can open them
  // any time the bike is on their docket — no second "Load photos" hop.
  const loadPacket = route.panel === "packet" && Boolean(route.workOrderId);

  const [floor, docket, readyForPickup, packetBundle] = await Promise.all([
    hasSelection
      ? getTechnicianFloorOs({
          jobId: route.jobId,
          workOrderId: route.workOrderId,
          mode: modeForFetch(route.stage),
          view,
        })
      : Promise.resolve(emptyFloorOs()),
    isFloorTech(viewRole)
      ? getTechnicianDocket(subjectUserId).catch(() => null)
      : Promise.resolve(null),
    // Pickup queue is front-office only — floor techs stay on their docket.
    isFloorTech(viewRole)
      ? Promise.resolve([])
      : listReadyForPickup({ hrefFor: (id) => techJobPacketHref(id) }).catch(() => []),
    loadPacket
      ? (async () => {
          // Photos load only after the subject's packet access check passes.
          const packet = await getJobPacket(route.workOrderId!, { view }).catch(
            () => null
          );
          const photos = packet
            ? await listIntakePhotos(route.workOrderId!).catch(() => [])
            : [];
          return { packet, photos };
        })()
      : Promise.resolve({ packet: null, photos: [] }),
  ]);

  // Explicit stage only — the shell derives the default per surface, so URLs
  // never pin a stage the tech didn't choose.
  return (
    <TechnicianFloorShell
      floor={floor}
      stage={route.stage ?? undefined}
      viewerUserId={subjectUserId}
      previewMode={techPreview}
      docketItems={docket?.items ?? []}
      readyForPickup={readyForPickup}
      panel={route.panel}
      packet={packetBundle.packet}
      packetSection={route.packetSection}
      packetPhotos={packetBundle.photos}
      packetWorkOrderId={route.workOrderId}
      packetJobId={route.jobId}
    />
  );
}
