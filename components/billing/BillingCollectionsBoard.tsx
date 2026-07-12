"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { BillingBoardItem } from "@/lib/services/billingBoard";
import { BILLING_BUCKET_LABELS } from "@/lib/billing/buckets";
import {
  publishSquareBalanceAction,
  publishSquareInvoiceAction,
  sendEstimateApprovalAction,
  syncSquareDraftAction,
} from "@/app/(app)/work_orders/square-actions";
import { sendMessageAction } from "@/app/(app)/work_orders/communication-actions";
import { EmptyState } from "@/components/ui/EmptyState";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function BillingCard({
  item,
  showQuickActions,
}: {
  item: BillingBoardItem;
  showQuickActions: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <article className="card">
      <div className="card-body flex flex-col gap-2">
        <div className="wo-card-hero">
          <p className="wo-card-bike">{item.motorcycle_label}</p>
          <p className="wo-card-customer">{item.customer_label}</p>
        </div>
        <p className="wo-card-meta">
          {BILLING_BUCKET_LABELS[item.bucket]}
          {item.square_payment_status ? ` · ${item.square_payment_status}` : ""}
        </p>
        <p className="wo-card-meta">
          Est {money(item.estimate_cents)} · Collected{" "}
          {money(item.billing_collected_cents)} · Due{" "}
          {money(item.remaining_cents)}
        </p>
        <div className="wo-card-footer">
          <div className="wo-card-id-row">
            <Link href={item.href} className="wo-card-number data-table-link">
              {item.work_order_number}
            </Link>
            <span className="badge bg-[var(--status-waiting-bg)] text-[var(--status-waiting-fg)]">
              {item.billing_stage}
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {item.square_invoice_public_url ? (
            <a
              href={item.square_invoice_public_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
            >
              Payment link
            </a>
          ) : null}
          <Link href={item.href} className="btn btn-secondary">
            Open WO
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const reminder = await sendMessageAction(
                  item.work_order_id,
                  "payment_reminder",
                  "email"
                );
                if (reminder.error) {
                  await sendEstimateApprovalAction(item.work_order_id, "email");
                }
              })
            }
          >
            Remind / approve
          </button>
          {showQuickActions ? (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await syncSquareDraftAction(item.work_order_id);
                  })
                }
              >
                Sync draft
              </button>
              {item.bucket === "ready_to_invoice" || item.bucket === "unpaid" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await publishSquareInvoiceAction(item.work_order_id, {
                        mode: "full",
                      });
                    })
                  }
                >
                  Publish full
                </button>
              ) : null}
              {item.bucket === "balance_due" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await publishSquareBalanceAction(item.work_order_id);
                    })
                  }
                >
                  Publish balance
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const COLLECTION_BUCKETS = [
  "awaiting_approval",
  "ready_to_invoice",
  "unpaid",
  "balance_due",
] as const;

export function BillingCollectionsBoard({
  items,
  showQuickActions = false,
}: {
  items: BillingBoardItem[];
  showQuickActions?: boolean;
}) {
  const actionable = items.filter((i) =>
    (COLLECTION_BUCKETS as readonly string[]).includes(i.bucket)
  );

  if (actionable.length === 0) {
    return (
      <EmptyState
        title="Nothing needs attention"
        description="When estimates need approval or invoices need payment, they show up here."
        action={{ href: "/work_orders", label: "View work orders" }}
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
      {COLLECTION_BUCKETS.map((bucket) => {
        const column = actionable.filter((i) => i.bucket === bucket);
        return (
          <section key={bucket} className="shop-board-column" aria-label={bucket}>
            <header className="shop-board-column-header">
              <h2 className="shop-board-column-title">
                {BILLING_BUCKET_LABELS[bucket]}
              </h2>
              <span className="shop-board-column-count">{column.length}</span>
            </header>
            <div className="shop-board-column-body flex flex-col gap-3">
              {column.length === 0 ? (
                <EmptyState description="None" />
              ) : (
                column.map((item) => (
                  <BillingCard
                    key={item.work_order_id}
                    item={item}
                    showQuickActions={showQuickActions}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
