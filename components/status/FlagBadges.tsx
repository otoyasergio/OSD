const FLAG_STYLES: Record<string, string> = {
  "Missing VIN": "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  "No intake photos": "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
  "Incomplete inspection":
    "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-1 ring-[var(--status-warning)]/20",
  "Needs approval": "bg-[var(--status-info-bg)] text-[var(--status-info-fg)]",
  "Waiting for parts": "bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]",
  "Safety-critical":
    "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] ring-1 ring-[var(--status-danger)]/25",
  Overdue:
    "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)] ring-1 ring-[var(--status-danger)]/25",
  "On hold": "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]",
};

export function FlagBadges({
  flags,
  empty = "—",
}: {
  flags: string[];
  empty?: string;
}) {
  if (flags.length === 0) {
    return <span className="text-chrome-muted text-sm">{empty}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((flag) => (
        <span
          key={flag}
          className={`badge ${FLAG_STYLES[flag] ?? "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]"}`}
        >
          {flag}
        </span>
      ))}
    </div>
  );
}
