const FLAG_STYLES: Record<string, string> = {
  "Missing VIN": "bg-amber-100 text-amber-900",
  "Missing invoice #": "bg-amber-100 text-amber-900",
  "No intake photos": "bg-amber-100 text-amber-900",
  "Incomplete inspection": "bg-orange-100 text-orange-900",
  "Needs approval": "bg-sky-100 text-sky-900",
  "Waiting for parts": "bg-violet-100 text-violet-900",
  "Safety-critical": "bg-red-100 text-red-900",
  Overdue: "bg-red-100 text-red-900",
  "On hold": "bg-zinc-200 text-zinc-800",
};

export function FlagBadges({
  flags,
  empty = "—",
}: {
  flags: string[];
  empty?: string;
}) {
  if (flags.length === 0) {
    return <span className="text-zinc-400">{empty}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <span
          key={flag}
          className={`rounded px-2 py-0.5 text-xs font-semibold ${
            FLAG_STYLES[flag] ?? "bg-amber-100 text-amber-900"
          }`}
        >
          {flag}
        </span>
      ))}
    </div>
  );
}
