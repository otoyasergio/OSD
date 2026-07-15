import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAppUser } from "@/lib/auth/session";
import {
  getActiveAgreementTemplate,
  getDropOffAgreement,
} from "@/lib/services/contracts";
import { ContractSigningPanel } from "@/components/contracts/ContractSigningPanel";
import {
  signDropOffAgreementAction,
  uploadPaperAgreementCopyAction,
} from "@/app/(app)/work_orders/contract-actions";

export const dynamic = "force-dynamic";

export default async function WorkOrderContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ work_order_id: string }>;
  searchParams: Promise<{ from?: string; extra_photo_failures?: string }>;
}) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");

  const { work_order_id } = await params;
  const { from, extra_photo_failures: extraPhotoFailuresRaw } = await searchParams;
  const fromIntake = from === "intake";
  const parsedExtraPhotoFailures = Number.parseInt(extraPhotoFailuresRaw ?? "0", 10);
  const extraPhotoFailures = Number.isFinite(parsedExtraPhotoFailures)
    ? Math.max(0, parsedExtraPhotoFailures)
    : 0;
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
          {extraPhotoFailures > 0 ? (
            <>
              All 6 required intake photos are saved. {extraPhotoFailures} optional
              extra {extraPhotoFailures === 1 ? "photo" : "photos"} could not upload;
              you can add {extraPhotoFailures === 1 ? "it" : "them"} from the work
              order Photos tab afterward. The agreement can be signed now or later.
            </>
          ) : (
            <>
              Intake photos are saved. The agreement can be signed now or later; continue
              without signing if the customer is not ready.
            </>
          )}
        </p>
      ) : null}

      <ContractSigningPanel
        template={template}
        existing={agreement}
        action={signDropOffAgreementAction.bind(null, work_order_id)}
        continueHref={fromIntake ? workOrderHref : undefined}
        continueLabel="Continue to work order"
        allowPaperSignature
        paperCopyAction={uploadPaperAgreementCopyAction.bind(null, work_order_id)}
      />
    </div>
  );
}
