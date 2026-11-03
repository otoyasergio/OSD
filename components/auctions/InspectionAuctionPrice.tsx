import { inspectionAuctionCallout, inspectionPriceLine } from "@/lib/auctions/summary";
import type { AuctionPriceGuideView } from "@/lib/auctions/types";

export function InspectionAuctionPrice({
  guide,
}: {
  guide: AuctionPriceGuideView | null;
}) {
  const callout = inspectionAuctionCallout(guide);
  if (!callout || !guide) return null;
  const line = inspectionPriceLine(callout.points);
  const vehicle = `${guide.year} ${guide.make} ${guide.model}`
    .replace(/\s+/g, " ")
    .trim();

  return (
    <div className="inspection-auction-price">
      <p className="inspection-auction-vehicle">{vehicle}</p>
      <div className="inspection-auction-price-summary">
        <p className="inspection-auction-price-label">Price today</p>
        <div className="inspection-auction-price-figures">
          <p className="inspection-auction-price-amount">{callout.amount}</p>
          <p className="inspection-auction-price-note">
            {callout.caption}
            {callout.range ? ` · ${callout.range}` : ""}
          </p>
        </div>
      </div>
      {line.length > 0 ? (
        <figure className="inspection-auction-chart">
          <figcaption className="inspection-auction-chart-caption">
            Auction price by year of sale
          </figcaption>
          <div className="inspection-auction-line-scroll">
            <div
              className="inspection-auction-line"
              style={
                line.length > 5 ? { minWidth: `${line.length * 4.75}rem` } : undefined
              }
            >
              <div className="inspection-auction-line-prices">
                {line.map((point) => (
                  <span
                    key={point.saleYear}
                    className="inspection-auction-line-label"
                    style={{ left: `${point.x}%` }}
                  >
                    {point.amount}
                  </span>
                ))}
              </div>
              <div className="inspection-auction-line-stage">
                <svg
                  className="inspection-auction-line-svg"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {line.length > 1 ? (
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      points={line.map((point) => `${point.x},${point.y}`).join(" ")}
                    />
                  ) : null}
                </svg>
                {line.map((point) => (
                  <span
                    key={point.saleYear}
                    className="inspection-auction-line-dot"
                    style={{ left: `${point.x}%`, top: `${point.y}%` }}
                  />
                ))}
              </div>
              <div className="inspection-auction-line-years">
                {line.map((point) => (
                  <span
                    key={point.saleYear}
                    className="inspection-auction-line-label"
                    style={{ left: `${point.x}%` }}
                  >
                    {point.saleYear}
                  </span>
                ))}
              </div>
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
