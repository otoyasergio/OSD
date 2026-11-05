import { formatCalendarDate, formatDateTime } from "@/lib/datetime/format";
import { staffFeedbackRoleLabel } from "@/lib/staffFeedback/fields";
import type {
  StaffFeedbackDigestView,
  StaffFeedbackOpenReport,
} from "@/lib/services/staffFeedback";

function formatArchiveSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${Math.round((bytes / 1_000_000) * 10) / 10} MB`;
}

export function StaffFeedbackPanel({
  openReports,
  digests,
}: {
  openReports: StaffFeedbackOpenReport[];
  digests: StaffFeedbackDigestView[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-[var(--status-neutral)]">
        Notes staff send from the corner button when a screen doesn&apos;t make sense.
        Each night at 11:00 p.m. Toronto time, open notes and their pictures are packed
        into one archive.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Waiting to pack</h2>
        {openReports.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-[var(--status-neutral)]">
            No open notes. The corner button on every screen lets the shop send a picture
            and a note.
          </p>
        ) : (
          openReports.map((report) => (
            <article
              key={report.reportId}
              className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
            >
              <p className="text-sm text-[var(--status-neutral)]">
                {formatDateTime(report.createdAt)} · {report.actorName} ·{" "}
                {staffFeedbackRoleLabel(report.role)} · {report.pagePath}
              </p>
              <p className="whitespace-pre-wrap text-foreground">{report.note}</p>
              {report.screenshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
                <img
                  src={report.screenshotUrl}
                  alt={`Screen reported by ${report.actorName}`}
                  className="max-h-80 w-full rounded border border-[var(--border)] object-contain object-top"
                />
              ) : (
                <p className="text-sm text-[var(--status-neutral)]">
                  No picture with this note.
                </p>
              )}
            </article>
          ))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Packed nights</h2>
        {digests.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-[var(--status-neutral)]">
            Nothing has been packed yet.
          </p>
        ) : (
          digests.map((digest) => (
            <article
              key={digest.digestId}
              className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-foreground">
                  {formatCalendarDate(digest.shopDate)} · {digest.reportCount}{" "}
                  {digest.reportCount === 1 ? "note" : "notes"} ·{" "}
                  {formatArchiveSize(digest.archiveBytes)}
                </h3>
                {digest.archiveUrl ? (
                  <a
                    href={digest.archiveUrl}
                    className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Download pictures
                  </a>
                ) : (
                  <p className="text-sm text-[var(--status-neutral)]">
                    The archive file is not available yet.
                  </p>
                )}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">
                {digest.summary}
              </pre>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
