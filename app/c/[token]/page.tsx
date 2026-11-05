import Image from "next/image";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { EmptyBikeFrame } from "@/components/ui/EmptyBikeFrame";
import {
  getPortalContractTemplate,
  getPortalEstimate,
  getPortalWorkOrder,
} from "@/lib/services/portal";
import { loadAuctionPriceGuide } from "@/lib/services/auctionPriceGuide";
import { PortalClient } from "@/components/portal/PortalClient";

export const dynamic = "force-dynamic";

function customerStageLabel(status: string): string {
  switch (status) {
    case "waiting_for_customer_approval":
      return "Waiting on your approval";
    case "ready_for_pickup":
      return "Ready to pick up";
    case "completed":
      return "Picked up";
    case "cancelled":
      return "Cancelled";
    case "waiting_for_parts":
      return "Waiting on parts";
    case "in_storage":
      return "In storage";
    case "on_hold":
      return "On hold";
    case "insurance":
      return "With insurance";
    default:
      return "In the shop";
  }
}

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
  const auctionGuide = await loadAuctionPriceGuide({
    motorcycleId: view.motorcycle_id,
    bike: view.motorcycle,
    audience: "customer",
  });
  if (auctionGuide.refreshInBackground) {
    after(() => {
      void loadAuctionPriceGuide({
        motorcycleId: view.motorcycle_id,
        bike: view.motorcycle,
        audience: "customer",
        refresh: "force",
      }).catch(() => undefined);
    });
  }

  const bikeTitle = `${view.motorcycle.year} ${view.motorcycle.make} ${view.motorcycle.model}`;

  return (
    <div className="min-h-dvh bg-[var(--background)] px-4 py-8 portal-page">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <header className="portal-mast">
          <Image
            src="/otomoto-logo.png"
            alt="OTOMOTO Toronto Moto"
            width={220}
            height={72}
            className="brand-logo brand-logo--mobile"
            priority
          />
          <p className="mt-3 font-mono text-xs font-bold tracking-[0.14em] text-[var(--signal-teal-bright)]">
            {view.work_order_number}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{bikeTitle}</h1>
          <p className="mt-1 text-sm text-[var(--chrome-muted)]">
            {view.customer.first_name} {view.customer.last_name}
          </p>
          <span className="stage-chip stage-chip--teal mt-3">
            {customerStageLabel(view.status)}
          </span>
        </header>
        <div className="photo-action-card-media">
          {view.hero_photo_url ? (
            // Signed storage URLs are short-lived.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={view.hero_photo_url} alt="" className="photo-action-card-img" />
          ) : (
            <EmptyBikeFrame />
          )}
        </div>
        <div className="p-4 sm:p-6">
          <PortalClient
            token={token}
            view={view}
            contractTemplate={template}
            estimate={estimate}
            auctionGuide={auctionGuide.view}
          />
        </div>
      </div>
    </div>
  );
}
