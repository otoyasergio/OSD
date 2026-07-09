import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { AppShell } from "@/components/layout/AppShell";
import type { LocationOption } from "@/components/layout/LocationSwitcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect("/login");
  }

  if (!user.active_location_id) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-zinc-50 px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">No location</h1>
          <p className="mt-3 text-zinc-600">
            Contact owner to assign a location before using the workshop app.
          </p>
        </div>
      </div>
    );
  }

  let locations: LocationOption[] = [];
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    user.location_ids.length > 0
  ) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("location")
      .select("location_id, name, code")
      .in("location_id", user.location_ids)
      .eq("status", "active")
      .order("name");
    locations = (data ?? []) as LocationOption[];
  }

  return (
    <AppShell user={user} locations={locations}>
      {children}
    </AppShell>
  );
}
