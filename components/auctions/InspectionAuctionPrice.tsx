import { inspectionAuctionCallout } from "@/lib/auctions/summary";
import type { AuctionPriceGuideView } from "@/lib/auctions/types";

export function InspectionAuctionPrice({
  guide,
}: {
  guide: AuctionPriceGuideView | null;
}) {
  const callout = inspectionAuctionCallout(guide);
  if (!callout) return null;
  const max = Math.max(0, ...callout.points.map((point) => point.medianCad));

  return (
    <div className="inspection-auction-price">
      <div className="inspection-auction-price-summary">
        <p className="inspection-auction-price-label">Auction value</p>
        <div className="inspection-auction-price-figures">
          <p className="inspection-auction-price-amount">{callout.amount}</p>
          <p className="inspection-auction-price-note">
            {callout.caption}
            {callout.range ? ` · ${callout.range}` : ""}
          </p>
        </div>
      </div>
      {callout.points.length > 0 ? (
        <figure className="inspection-auction-chart">
          <figcaption className="inspection-auction-chart-caption">
            Auction price by year of sale
          </figcaption>
          <div className="inspection-auction-chart-scroll">
            <div
              className="inspection-auction-chart-plot"
              role="list"
              aria-label="Median auction price by year of sale, in Canadian dollars"
              style={
                callout.points.length > 6
                  ? { minWidth: `${callout.points.length * 4.5}rem` }
                  : undefined
              }
            >
              {callout.points.map((point) => {
                const height = max > 0 ? Math.max(8, (point.medianCad / max) * 100) : 0;
                return (
                  <div
                    key={point.saleYear}
                    className="inspection-auction-chart-col"
                    role="listitem"
                  >
                    <span className="inspection-auction-chart-value">{point.amount}</span>
                    <span className="inspection-auction-chart-track">
                      <span
                        className="inspection-auction-chart-bar"
                        style={{ height: `${height}%` }}
                      />
                    </span>
                    <span className="inspection-auction-chart-year">
                      {point.saleYear}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {callout.historyNote ? (
            <p className="inspection-auction-chart-note">{callout.historyNote}</p>
          ) : null}
        </figure>
      ) : null}
    </div>
  );
}
