import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  getActiveAgreementTemplate,
  getDropOffAgreement,
} from "@/lib/services/contracts";
import { ContractSigningPanel } from "@/components/contracts/ContractSigningPanel";
import { signDropOffAgreementAction } from "@/app/(app)/work_orders/contract-actions";

export const dynamic = "force-dynamic";

export default async function WorkOrderContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ work_order_id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const { from } = await searchParams;
  const fromIntake = from === "intake";
  const workOrderHref = `/work_orders/${work_order_id}`;

  const [template, agreement] = await Promise.all([
    getActiveAgreementTemplate(),
    getDropOffAgreement(work_order_id),
  ]);

  if (!template) {
    return (
      <div className="page-stack page-stack--narrow">
        <p>No drop-off agreement template is configured.</p>
        <Link href={workOrderHref}>← Back to work order</Link>
      </div>
    );
  }

  return (
    <div className="inspection-fullscreen page-stack">
      <div className="flex items-center justify-between gap-4">
        <Link
          href={workOrderHref}
          className="text-sm underline-offset-2 hover:underline"
        >
          ← Work order
        </Link>
        <h1 className="text-lg font-semibold">Drop-off agreement</h1>
      </div>

      {fromIntake && !agreement ? (
        <p className="rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-[var(--status-neutral-fg)]">
          Intake photos are saved. Sign the drop-off agreement next, then continue
          to the work order.
        </p>
      ) : null}

      <ContractSigningPanel
        template={template}
        existing={agreement}
        action={signDropOffAgreementAction.bind(null, work_order_id)}
        continueHref={fromIntake ? workOrderHref : undefined}
        continueLabel="Continue to work order"
      />
    </div>
  );
}
