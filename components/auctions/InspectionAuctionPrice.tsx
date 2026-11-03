import { inspectionAuctionCallout } from "@/lib/auctions/summary";
import type { AuctionPriceGuideView } from "@/lib/auctions/types";

export function InspectionAuctionPrice({
  guide,
}: {
  guide: AuctionPriceGuideView | null;
}) {
  const callout = inspectionAuctionCallout(guide);
  if (!callout) return null;

  return (
    <div className="inspection-auction-price" role="status">
      <p className="inspection-auction-price-label">Auction value</p>
      <p className="inspection-auction-price-amount">{callout.amount}</p>
      <p className="inspection-auction-price-note">
        {callout.caption}
        {callout.range ? ` · ${callout.range}` : ""}
      </p>
    </div>
  );
}
