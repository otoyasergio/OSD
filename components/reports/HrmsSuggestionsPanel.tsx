import Link from "next/link";
import type { HrmsSuggestion } from "@/lib/services/hrmsSuggestions";

const SEVERITY_CLASS: Record<HrmsSuggestion["severity"], string> = {
  action: "border-[var(--status-danger)]/40 bg-[var(--status-danger)]/5",
  watch: "border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5",
  info: "border-[var(--border)] bg-[var(--surface-muted)]",
};

export function HrmsSuggestionsPanel({ suggestions }: { suggestions: HrmsSuggestion[] }) {
  if (suggestions.length === 0) {
    return (
      <section className="card card-pad">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          HRMS suggestions
        </h2>
        <p className="mt-3 text-sm text-[var(--status-neutral)]">
          No attendance or EE-record suggestions right now.
        </p>
      </section>
    );
  }

  return (
    <section className="card card-pad space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
          HRMS suggestions
        </h2>
        <p className="mt-1 text-xs text-[var(--status-neutral)]">
          Operational prompts based on attendance and EE files — not legal advice. See{" "}
          <a
            href="https://www.ontario.ca/document/your-guide-employment-standards-act-0/record-keeping"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Ontario ESA record keeping
          </a>
          .
        </p>
      </div>
      <ul className="space-y-2">
        {suggestions.slice(0, 12).map((s) => (
          <li
            key={s.id}
            className={`rounded-lg border px-3 py-2 text-sm ${SEVERITY_CLASS[s.severity]}`}
          >
            <p className="font-medium text-foreground">{s.title}</p>
            <p className="mt-0.5 text-[var(--status-neutral)]">{s.detail}</p>
            {s.href ? (
              <Link
                href={s.href}
                className="mt-1 inline-block text-xs font-medium underline"
              >
                Open
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
