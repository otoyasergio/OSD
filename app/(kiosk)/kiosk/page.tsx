import { KioskShell } from "@/components/kiosk/KioskShell";
import { listKioskStaff } from "@/lib/services/timeClockKiosk";

export const dynamic = "force-dynamic";

export default async function KioskPage() {
  const staff = await listKioskStaff();
  return <KioskShell staff={staff} />;
}
