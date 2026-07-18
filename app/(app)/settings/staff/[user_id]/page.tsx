import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageStaffProfiles } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getStaffEmploymentRecord,
  getStaffProfileUser,
  listStaffDocuments,
  listStaffNotes,
} from "@/lib/services/staffProfiles";
import { listRecentPunchesForStaff } from "@/lib/services/timeClock";
import {
  STAFF_DOCUMENT_CATEGORY_LABELS,
  retentionLabelForCategory,
  type StaffDocumentCategory,
} from "@/lib/services/staffDocumentRetention";
import { formatDateTime } from "@/lib/datetime/format";
import { StaffProfileForms } from "@/components/settings/StaffProfileForms";
import {
  addNoteAction,
  clearPinAction,
  setPinAction,
  updateEmploymentAction,
  uploadDocumentAction,
  voidDocumentAction,
  voidNoteAction,
} from "@/app/(app)/settings/staff/[user_id]/actions";

export const dynamic = "force-dynamic";

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ user_id: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageStaffProfiles(user.role)) redirect("/settings");

  const { user_id: userId } = await params;
  const [profile, employment, notes, documents, punches] = await Promise.all([
    getStaffProfileUser(userId),
    getStaffEmploymentRecord(userId),
    listStaffNotes(userId),
    listStaffDocuments(userId),
    listRecentPunchesForStaff(userId).catch(() => []),
  ]);

  const categories = Object.entries(STAFF_DOCUMENT_CATEGORY_LABELS).map(
    ([value, label]) => ({
      value: value as StaffDocumentCategory,
      label,
      retentionHint: retentionLabelForCategory(value as StaffDocumentCategory),
    })
  );

  return (
    <div className="page-stack page-stack--narrow flex flex-col gap-6">
      <div>
        <Link
          href="/settings/users"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Users
        </Link>
        <PageHeader
          title={`${profile.first_name} ${profile.last_name}`}
          subtitle={`${profile.role} · ${profile.email} · ${profile.status}`}
        />
      </div>

      <StaffProfileForms
        hasPin={profile.has_time_clock_pin}
        employment={employment}
        notes={notes}
        documents={documents}
        categories={categories}
        updateEmploymentAction={updateEmploymentAction.bind(null, userId)}
        setPinAction={setPinAction.bind(null, userId)}
        clearPinAction={clearPinAction.bind(null, userId)}
        addNoteAction={addNoteAction.bind(null, userId)}
        voidNoteAction={voidNoteAction.bind(null, userId)}
        uploadDocumentAction={uploadDocumentAction.bind(null, userId)}
        voidDocumentAction={voidDocumentAction.bind(null, userId)}
      />

      <section className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-foreground">Recent attendance</h2>
          <Link href="/settings/timesheets" className="text-sm underline">
            Open timesheets
          </Link>
        </div>
        <p className="text-xs text-[var(--status-neutral)]">
          Hours of work for Ontario ESA come from the shared time clock ledger (including
          kiosk punches and photos).
        </p>
        {punches.length === 0 ? (
          <p className="text-sm text-[var(--status-neutral)]">No recent punches.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {punches.map((entry) => (
              <li key={entry.entry_id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium text-foreground">
                    {formatDateTime(entry.clock_in_at)}
                    {" → "}
                    {entry.clock_out_at ? formatDateTime(entry.clock_out_at) : "open"}
                  </p>
                  {entry.notes ? (
                    <p className="text-[var(--status-neutral)]">{entry.notes}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: "In", url: entry.clock_in_photo_url },
                    { label: "Out", url: entry.clock_out_photo_url },
                    ...(entry.breaks ?? []).flatMap((b) => [
                      { label: "Meal↓", url: b.break_start_photo_url },
                      { label: "Meal↑", url: b.break_end_photo_url },
                    ]),
                  ]
                    .filter((t) => t.url)
                    .map((t) => (
                      <a
                        key={`${entry.entry_id}-${t.label}-${t.url}`}
                        href={t.url!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={t.url!}
                          alt={t.label}
                          className="h-12 w-12 rounded border border-[var(--border)] object-cover"
                          title={t.label}
                        />
                      </a>
                    ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
