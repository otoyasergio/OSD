import Link from "next/link";
import { formatDateTime } from "@/lib/datetime/format";
import type { BikeLinkAttentionItem } from "@/lib/services/bikeLink";

export function BikeLinkAttention({ items }: { items: BikeLinkAttentionItem[] }) {
  return (
    <section aria-label="Bikes that need a call">
      <h2 className="text-lg font-semibold text-foreground">Needs a call</h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        A reading says service is due, the battery is weak, or the bike reported a fault.
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-foreground">No readings need a call.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.motorcycleId}
              className="rounded border border-[var(--border)] bg-white px-4 py-3"
            >
              <p className="text-sm font-semibold text-foreground">
                <Link
                  href={`/motorcycles/${item.motorcycleId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {item.label}
                </Link>
                <span className="ml-2 font-medium text-[var(--status-neutral)]">
                  {item.level === "now" ? "Call now" : "Call soon"}
                </span>
              </p>
              <p className="mt-1 text-sm text-foreground">{item.clientNote}</p>
              <p className="mt-1 text-xs text-[var(--status-neutral)]">
                {item.customerName} · {item.origin} · {formatDateTime(item.recordedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
