import type { BillingDeskStats } from "@/lib/services/billingBoard";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function BillingMoneyDeskStats({ stats }: { stats: BillingDeskStats }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <div className="stat-card stat-card--success" aria-label="Collected today">
        <span className="stat-card-label">Collected today</span>
        <span className="stat-card-value stat-card-value--success">
          {money(stats.collected_today_cents)}
        </span>
      </div>
      <div className="stat-card stat-card--success" aria-label="Collected this week">
        <span className="stat-card-label">Collected this week</span>
        <span className="stat-card-value stat-card-value--success">
          {money(stats.collected_week_cents)}
        </span>
      </div>
      <div className="stat-card stat-card--danger" aria-label="Unpaid total">
        <span className="stat-card-label">Unpaid / due</span>
        <span className="stat-card-value stat-card-value--danger">
          {money(stats.unpaid_total_cents)}
        </span>
      </div>
      <div className="stat-card" aria-label="Ready to invoice count">
        <span className="stat-card-label">Ready to invoice</span>
        <span className="stat-card-value text-base">{stats.ready_to_invoice_count}</span>
      </div>
      <div className="stat-card" aria-label="Unpaid count">
        <span className="stat-card-label">Unpaid invoices</span>
        <span className="stat-card-value text-base">{stats.unpaid_count}</span>
      </div>
      <div className="stat-card stat-card--danger" aria-label="Balance due count">
        <span className="stat-card-label">Balance due</span>
        <span className="stat-card-value stat-card-value--danger">
          {stats.balance_due_count}
        </span>
      </div>
    </div>
  );
}
