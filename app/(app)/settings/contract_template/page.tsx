import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
import { canManageContractTemplate } from "@/lib/permissions";
import {
  getActiveAgreementTemplate,
  listAgreementTemplates,
} from "@/lib/services/contracts";
import { ContractTemplateEditor } from "@/components/contracts/ContractTemplateEditor";
import { publishContractTemplateAction } from "@/app/(app)/settings/contract_template/actions";

export const dynamic = "force-dynamic";

export default async function ContractTemplatePage() {
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageContractTemplate(user.role)) redirect("/dashboard");

  const [template, history] = await Promise.all([
    getActiveAgreementTemplate(),
    listAgreementTemplates(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Drop-off contract
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Edit the agreement customers initial and sign at drop-off. New intakes use the
          active version.
        </p>
      </div>

      {!template ? (
        <p className="text-sm text-zinc-600">
          No active template is configured. Publish one below to enable contract signing.
        </p>
      ) : null}

      <ContractTemplateEditor
        template={template}
        history={history}
        action={publishContractTemplateAction}
      />
    </div>
  );
}
