import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { AppShell } from "@/components/layout/AppShell";
import type { LocationOption } from "@/components/layout/LocationSwitcher";
import { getSupabasePublicConfig } from "@/lib/database/config";
import { createProfilePhotoSignedUrl } from "@/lib/profilePhotos/storage";
import { SignOutButton } from "@/components/layout/SignOutButton";
import { isFloorTech } from "@/lib/permissions/checks";
import { listUnreadStaffNotifications } from "@/lib/services/staffNotifications";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect("/login");
  }

  if (!user.active_location_id) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-background px-4">
        <div className="card max-w-md p-8 text-center">
          <h1 className="page-title">No location</h1>
          <p className="page-subtitle mt-3">
            Contact owner to assign a location before using the workshop app.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/account" className="btn btn-primary">
              Manage my account
            </Link>
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }

  let locations: LocationOption[] = [];
  if (getSupabasePublicConfig() && user.location_ids.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("location")
      .select("location_id, name, code")
      .in("location_id", user.location_ids)
      .eq("status", "active")
      .order("name");
    locations = (data ?? []) as LocationOption[];
  }

  const supabase = await createClient();
  const [profilePhotoUrl, initialNotifications] = await Promise.all([
    createProfilePhotoSignedUrl(supabase, user.profile_photo_path),
    isFloorTech(user.role) ? listUnreadStaffNotifications() : Promise.resolve([]),
  ]);

  return (
    <AppShell
      user={user}
      locations={locations}
      profilePhotoUrl={profilePhotoUrl}
      initialNotifications={initialNotifications}
    >
      {children}
    </AppShell>
  );
}
