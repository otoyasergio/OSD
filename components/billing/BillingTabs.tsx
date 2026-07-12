import Link from "next/link";
import type { BillingTab } from "@/lib/permissions/checks";

const TAB_META: { id: BillingTab; label: string }[] = [
  { id: "collections", label: "Collections" },
  { id: "money_desk", label: "Money desk" },
  { id: "ledger", label: "Ledger" },
];

export function BillingTabs({
  active,
  allowed,
}: {
  active: BillingTab;
  allowed: BillingTab[];
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Billing views">
      {TAB_META.filter((tab) => allowed.includes(tab.id)).map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={`/billing?tab=${tab.id}`}
            role="tab"
            aria-selected={isActive}
            className={isActive ? "btn btn-primary" : "btn btn-secondary"}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
