import { notFound } from "next/navigation";
import {
  getPortalContractTemplate,
  getPortalEstimate,
  getPortalWorkOrder,
} from "@/lib/services/portal";
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

  // Anonymous-safe template read (the staff-authenticated variant would
  // reject portal visitors who still need to sign). Only fetched when the
  // token's purpose actually allows signing.
  const template =
    view.has_signed_contract || !view.can_sign_contract
      ? null
      : await getPortalContractTemplate();
  const estimate = view.can_decide_estimate
    ? await getPortalEstimate(token).catch(() => null)
    : null;

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
            {view.customer.first_name} {view.customer.last_name} · {view.motorcycle.year}{" "}
            {view.motorcycle.make} {view.motorcycle.model}
          </p>
        </header>
        <PortalClient
          token={token}
          view={view}
          contractTemplate={template}
          estimate={estimate}
        />
      </div>
    </div>
  );
}
