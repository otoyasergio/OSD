import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canManageLegalParameters } from "@/lib/permissions";
import { listLegalParameters } from "@/lib/services/legalParameters";
import { PageHeader } from "@/components/ui/PageHeader";
import { LegalParameterForm } from "@/components/settings/LegalParameterForm";

export const dynamic = "force-dynamic";

function shopDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
  }).format(new Date(iso));
}

export default async function LegalParametersPage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canManageLegalParameters(preview.role)) redirect("/settings");

  const parameters = await listLegalParameters();

  return (
    <div className="page-stack">
      <PageHeader
        title="Estimate rules"
        subtitle="Append-only. A presented estimate keeps the row that was in force that day."
      />
      <p className="text-sm text-[var(--status-neutral)]">
        <Link href="/settings" className="underline-offset-2 hover:underline">
          Settings
        </Link>
      </p>
      <LegalParameterForm />
      <ul className="space-y-3">
        {parameters.length === 0 ? (
          <li className="card card-pad text-sm text-[var(--status-neutral)]">
            No rule row is on this database yet.
          </li>
        ) : (
          parameters.map((row) => (
            <li key={row.legal_parameter_id} className="card card-pad space-y-2">
              <p className="font-semibold text-foreground">
                In force {shopDate(row.effective_at)} · ceiling {row.ceiling_bps / 100}%
              </p>
              <p className="text-sm text-[var(--status-neutral)]">
                {row.source_citation}
              </p>
              <p className="text-sm">{row.estimate_fee_rule}</p>
              <p className="text-sm">{row.warranty_summary}</p>
              <p className="text-sm">{row.warranty_exemptions}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
