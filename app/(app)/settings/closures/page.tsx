import Link from "next/link";
import { redirect } from "next/navigation";
import { addShopClosureAction, deleteShopClosureAction } from "./actions";
import { ShopClosureForm } from "@/components/forms/ShopClosureForm";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { formatCalendarDate } from "@/lib/datetime/format";
import { canManageShopClosures } from "@/lib/permissions";
import { listUpcomingShopClosures } from "@/lib/services/shopClosures";

export const dynamic = "force-dynamic";

export default async function ShopClosuresPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canManageShopClosures(preview.role)) redirect("/settings");

  const closures = await listUpcomingShopClosures();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Shop closures
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Holidays and special closures for your active location. Owners and managers can
          make changes.
        </p>
      </div>

      <ShopClosureForm action={addShopClosureAction} />

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          Upcoming closures
        </h2>
        {closures.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-6 text-center text-sm text-[var(--status-neutral)]">
            No upcoming closure dates.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
            {closures.map((closure) => (
              <li
                key={closure.closure_date}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <div className="font-semibold text-foreground">
                    {formatCalendarDate(closure.closure_date)}
                  </div>
                  <div className="text-sm text-[var(--status-neutral)]">
                    {closure.reason || "Special closure"}
                  </div>
                </div>
                <form action={deleteShopClosureAction.bind(null, closure.closure_date)}>
                  <SubmitButton
                    label="Remove"
                    pendingLabel="Removing…"
                    variant="danger"
                  />
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
