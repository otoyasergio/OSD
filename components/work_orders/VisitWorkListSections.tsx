import type { VisitWorkList, VisitWorkListItem } from "@/lib/work-orders/visitWorkList";
import { JOB_ORIGIN_LABELS } from "@/lib/work-orders/visitWorkList";

function WorkListSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: VisitWorkListItem[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--status-neutral)]">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--border)]">
          {items.map((item) => (
            <li key={item.key} className="py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-foreground">{item.title}</span>
                <span className="text-[var(--status-neutral)]">
                  {[item.authorization, item.work !== "—" ? item.work : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {item.origin ? (
                <p className="mt-0.5 text-xs text-[var(--status-neutral)]">
                  {JOB_ORIGIN_LABELS[item.origin]}
                </p>
              ) : null}
              {item.notes ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {item.notes}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Overview visit story: asked / recommended / tech does this / not doing. */
export function VisitWorkListSections({ list }: { list: VisitWorkList }) {
  return (
    <div className="flex flex-col gap-5">
      <WorkListSection
        title="Customer asked"
        empty="No booked services on this visit."
        items={list.customerAsked}
      />
      <WorkListSection
        title="Recommended"
        empty="No open recommendations."
        items={list.recommended}
      />
      <WorkListSection
        title="Tech does this"
        empty="No authorized work yet."
        items={list.techDoesThis}
      />
      {list.notDoing.length > 0 ? (
        <WorkListSection title="Not doing" empty="" items={list.notDoing} />
      ) : null}
    </div>
  );
}
