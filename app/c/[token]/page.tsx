import { notFound } from "next/navigation";
import { getPortalWorkOrder } from "@/lib/services/portal";
import { getActiveAgreementTemplate } from "@/lib/services/contracts";
import { PortalClient } from "@/components/portal/PortalClient";

export const dynamic = "force-dynamic";

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let view;
  try {
    view = await getPortalWorkOrder(token);
  } catch {
    notFound();
  }

  const template = view.has_signed_contract ? null : await getActiveAgreementTemplate();

  return (
    <div className="min-h-dvh bg-zinc-100 px-4 py-8 portal-page">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Toronto Moto
          </p>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900">
            {view.work_order_number}
          </h1>
          <p className="text-sm text-zinc-600">
            {view.customer.first_name} {view.customer.last_name} ·{" "}
            {view.motorcycle.year} {view.motorcycle.make} {view.motorcycle.model}
          </p>
        </header>
        <PortalClient token={token} view={view} contractTemplate={template} />
      </div>
    </div>
  );
}
