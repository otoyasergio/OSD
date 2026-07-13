import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { getOpenTimeClockEntry } from "@/lib/services/timeClock";
import { getTechnicianFloorOs, type FloorOsMode } from "@/lib/services/technicianFloor";
import { TechnicianFloorShell } from "@/components/technician/TechnicianFloorShell";

export const dynamic = "force-dynamic";

export default async function TechnicianPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; wo?: string; mode?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const mode = (
    ["job", "inspection", "parts", "qc", "notes"].includes(params.mode ?? "")
      ? params.mode
      : "job"
  ) as FloorOsMode;

  const [floor, openClock] = await Promise.all([
    getTechnicianFloorOs({
      jobId: params.job ?? null,
      workOrderId: params.wo ?? null,
      mode,
    }),
    getOpenTimeClockEntry(user.user_id),
  ]);

  return <TechnicianFloorShell floor={floor} openClock={openClock} />;
}
