import Link from "next/link";
import type { IntakeFollowUp } from "@/lib/forms/intakeCompletion";

type Props = {
  workOrderId: string;
  followUp: IntakeFollowUp;
};

const CONTENT: Record<
  IntakeFollowUp,
  { title: string; description: string; action: string }
> = {
  signature: {
    title: "Drop-off agreement not signed",
    description:
      "The agreement is optional and can be collected when the customer is ready.",
    action: "Collect signature",
  },
  paper_copy: {
    title: "Signed paper copy not attached",
    description: "Attach it when available. Staff can continue working in the meantime.",
    action: "Attach paper copy",
  },
};

export function AgreementFollowUpNotice({ workOrderId, followUp }: Props) {
  const content = CONTENT[followUp];

  return (
    <aside
      aria-label="Intake follow-up"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide">Intake follow-up</p>
        <p className="font-semibold">{content.title}</p>
        <p className="text-sm">{content.description}</p>
      </div>
      <Link
        href={`/work_orders/${workOrderId}/contract`}
        className="btn btn-secondary min-h-11"
      >
        {content.action}
      </Link>
    </aside>
  );
}
