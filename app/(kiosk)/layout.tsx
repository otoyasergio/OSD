import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canUseTimeClockKiosk, staffHomePath } from "@/lib/permissions";
import { SignOutButton } from "@/components/layout/SignOutButton";

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect("/login");
  }
  if (!canUseTimeClockKiosk(user.role)) {
    redirect(staffHomePath(user.role));
  }
  if (!user.active_location_id) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--background)] px-4 text-center">
        <h1 className="text-2xl font-semibold text-foreground">No location</h1>
        <p className="mt-2 max-w-md text-[var(--status-neutral)]">
          Assign this kiosk account to a shop location before using the time clock.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[var(--background)] text-foreground">{children}</div>
  );
}
