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
import { getJobPacket, type JobPacket } from "@/lib/services/jobPacket";
import { listIntakePhotos, type IntakePhoto } from "@/lib/services/photos";
import type { UserRole } from "@/lib/database/types";
import { isFloorTech } from "@/lib/permissions";
import {
  askOtomotoCapabilities,
  loadAskOtomotoPanelData,
} from "@/lib/diagnostics/assistantPageState";
import type { AskOtomotoPanelData } from "@/lib/diagnostics/askOtomotoView";
import { getAskOtomotoPublicConfig } from "@/lib/diagnostics/config";
import { toDiagnosticsPhotoSourceRows } from "@/lib/diagnostics/photoSelection";
import { TechnicianFloorShell } from "@/components/technician/TechnicianFloorShell";
import { techJobPacketHref } from "@/lib/technician/assignmentHref";
import {
  parseTechnicianRouteState,
  type TechnicianRouteParams,
  type TechnicianRouteState,
} from "@/lib/technician/routeState";
import type { FloorStage } from "@/lib/technician/floorStage";
import { createDiagnosticsAssistantService } from "@/lib/services/diagnosticsAssistant";

export const dynamic = "force-dynamic";
const diagnosticsAssistant = createDiagnosticsAssistantService();

function modeForFetch(stage: FloorStage | null): FloorOsMode {
  if (stage === "inspect") return "inspection";
  if (stage === "qc") return "qc";
  if (stage === "safety") return "safety";
  return "job";
}

type PacketBundle = {
  packet: JobPacket | null;
  photos: IntakePhoto[];
  assistant: AskOtomotoPanelData | null;
};

const EMPTY_PACKET: PacketBundle = { packet: null, photos: [], assistant: null };

async function loadPacketBundle({
  route,
  viewRole,
  isPreviewing,
  packetView,
  assistantView,
}: {
  route: TechnicianRouteState;
  viewRole: UserRole;
  isPreviewing: boolean;
  packetView: ReadView | undefined;
  assistantView: ReadView | undefined;
}): Promise<PacketBundle> {
  const workOrderId = route.workOrderId!;
  // Photos and assistant data load only after the subject's packet access check passes.
  const packet = await getJobPacket(workOrderId, { view: packetView }).catch(() => null);
  if (!packet) return EMPTY_PACKET;

  const assistantActive = route.packetSection === "assistant";
  const jobLabels = Object.fromEntries(
    packet.jobs.map((job) => [job.job_id, job.service_name])
  );
  const [photos, assistantData] = await Promise.all([
    listIntakePhotos(workOrderId).catch(() => []),
    assistantActive
      ? loadAskOtomotoPanelData({
          service: diagnosticsAssistant,
          surface: "floor",
          workOrderId,
          threadId: route.assistantThreadId,
          readView: assistantView,
          jobLabels,
        })
      : Promise.resolve(null),
  ]);
  if (!assistantData) return { packet, photos, assistant: null };

  // A route job only scopes a new thread when this viewer may work it; a floor
  // tech's query string can't claim another technician's job.
  const currentJob =
    packet.jobs.find(
      (job) =>
        job.job_id === route.jobId && (!isFloorTech(viewRole) || job.assigned_to_me)
    ) ?? null;
  const { workspace } = assistantData;
  const selectedThreadJobAssignedToViewer = workspace?.thread.jobId
    ? packet.jobs.some(
        (job) => job.job_id === workspace.thread.jobId && job.assigned_to_me
      )
    : true;
  return {
    packet,
    photos,
    assistant: {
      route: {
        surface: "floor",
        workOrderId,
        jobId: route.jobId,
        stage: route.stage,
      },
      threads: assistantData.threads,
      selectedThreadId: route.assistantThreadId,
      workspace,
      jobs: currentJob
        ? [{ jobId: currentJob.job_id, label: currentJob.service_name }]
        : [],
      defaultJobId: currentJob?.job_id ?? null,
      photos: workspace
        ? toDiagnosticsPhotoSourceRows(photos, {
            workOrderId,
            jobId: workspace.thread.jobId,
          })
        : [],
      config: getAskOtomotoPublicConfig(),
      capabilities: askOtomotoCapabilities({
        surface: "floor",
        viewRole,
        isForeignLocation: packet.is_foreign_location !== false,
        isPreviewing,
        workOrderStatus: packet.wo_status,
        selectedThreadJobAssignedToViewer,
      }),
      historyUnavailable: assistantData.historyUnavailable,
    },
  };
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
  // Assistant reads mirror any previewed role, not only a previewed technician.
  const assistantView: ReadView | undefined = preview.isPreviewing
    ? { role: viewRole, subjectUserId: preview.subjectUserId }
    : undefined;

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
    isFloorTech(viewRole) ? getTechnicianDocket(subjectUserId) : Promise.resolve(null),
    // Pickup queue is front-office only — floor techs stay on their docket.
    isFloorTech(viewRole)
      ? Promise.resolve([])
      : listReadyForPickup({ hrefFor: (id) => techJobPacketHref(id) }).catch(() => []),
    loadPacket
      ? loadPacketBundle({
          route,
          viewRole,
          isPreviewing: preview.isPreviewing,
          packetView: view,
          assistantView,
        })
      : EMPTY_PACKET,
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
      packetAssistant={packetBundle.assistant}
      packetWorkOrderId={route.workOrderId}
      packetJobId={route.jobId}
    />
  );
}
