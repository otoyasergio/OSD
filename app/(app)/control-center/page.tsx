import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canAssignTechnician, canViewDashboard, staffHomePath } from "@/lib/permissions";
import { getControlCenterData } from "@/lib/services/controlCenter";
import { ControlCenterShell } from "@/components/control-center/ControlCenterShell";

export const dynamic = "force-dynamic";

export default async function ControlCenterPage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canViewDashboard(user.role)) redirect(staffHomePath(user.role));

  const data = await getControlCenterData();

  return <ControlCenterShell data={data} canAssign={canAssignTechnician(user.role)} />;
}
