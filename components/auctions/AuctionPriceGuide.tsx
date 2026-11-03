import { formatCad, formatSaleDate } from "@/lib/auctions/summary";
import type { AuctionPriceGuideView } from "@/lib/auctions/types";

type Props = {
  guide: AuctionPriceGuideView;
  variant: "staff" | "portal";
  motorcycleId?: string;
  refreshAction?: (formData: FormData) => void | Promise<void>;
};

export function AuctionPriceGuide({
  guide,
  variant,
  motorcycleId,
  refreshAction,
}: Props) {
  const neutral = variant === "portal" ? "text-zinc-600" : "text-[var(--status-neutral)]";
  const heading =
    variant === "portal"
      ? "text-lg font-semibold"
      : "text-lg font-semibold text-foreground";
  const maxMedian = Math.max(0, ...guide.visibleHistory.map((point) => point.medianCad));

  return (
    <section
      aria-labelledby="auction-price-guide-heading"
      className={variant === "portal" ? "rounded-lg bg-white p-6 shadow-sm" : undefined}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="auction-price-guide-heading" className={heading}>
            Auction price guide
          </h2>
          <p className={`mt-1 text-sm ${neutral}`}>
            What similar motorcycles sold for at auction over time, in Canadian dollars.
          </p>
        </div>
        {variant === "staff" && refreshAction && motorcycleId ? (
          <form action={refreshAction}>
            <input type="hidden" name="motorcycle_id" value={motorcycleId} />
            <button type="submit" className="btn btn-secondary min-h-11">
              Update auction prices
            </button>
          </form>
        ) : null}
      </div>

      {guide.fixturePreview ? (
        <p
          role="status"
          className="mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          These rows are fixture data for preview. They are not live auction results.
        </p>
      ) : null}

      <p className="mt-4 text-base font-semibold text-foreground">{guide.headline}</p>
      <p className={`mt-1 text-sm ${neutral}`}>{guide.detail}</p>

      {guide.state === "ready" && guide.modelYearMedianCad != null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="stat-card">
            <span className="stat-card-label">Typical price</span>
            <span className="stat-card-value text-base">
              {formatCad(guide.modelYearMedianCad)}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">Low</span>
            <span className="stat-card-value text-base">
              {guide.modelYearLowCad != null ? formatCad(guide.modelYearLowCad) : "—"}
            </span>
          </div>
          <div className="stat-card">
            <span className="stat-card-label">High</span>
            <span className="stat-card-value text-base">
              {guide.modelYearHighCad != null ? formatCad(guide.modelYearHighCad) : "—"}
            </span>
          </div>
        </div>
      ) : null}

      {guide.visibleHistory.length > 0 ? (
        <div className="mt-5">
          <table className="w-full text-sm">
            <caption className={`mb-2 text-left font-medium ${neutral}`}>
              Median realized price by year of sale, in Canadian dollars
            </caption>
            <thead>
              <tr className={`border-b text-left ${neutral}`}>
                <th className="py-2 pr-3 font-medium">Sale year</th>
                <th className="py-2 pr-3 font-medium">Sales</th>
                <th className="py-2 font-medium">Typical price</th>
              </tr>
            </thead>
            <tbody>
              {guide.visibleHistory.map((point) => {
                const width =
                  maxMedian > 0 ? Math.max(8, (point.medianCad / maxMedian) * 100) : 0;
                return (
                  <tr key={point.saleYear} className="border-b border-zinc-100">
                    <td className="py-2 pr-3 tabular-nums">{point.saleYear}</td>
                    <td className="py-2 pr-3 tabular-nums">{point.count}</td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-3 sm:justify-start">
                        <div className="hidden h-2 w-28 overflow-hidden rounded bg-zinc-200 sm:block">
                          <div
                            className="h-2 rounded bg-[var(--chrome)]"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                        <span className="shrink-0 tabular-nums">
                          {formatCad(point.medianCad)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {guide.historyNote ? (
            <p className={`mt-2 text-xs ${neutral}`}>{guide.historyNote}</p>
          ) : null}
        </div>
      ) : null}

      {guide.comps.length > 0 ? (
        <ul className="mt-5 flex flex-col gap-3">
          {guide.comps.map((sale) => (
            <li
              key={`${sale.sourceId}-${sale.lotUrl ?? sale.title}-${sale.saleDate ?? ""}-${sale.priceCad}`}
              className="border-b border-zinc-100 pb-3 last:border-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{sale.title}</p>
                <p className="tabular-nums">{formatCad(sale.priceCad)}</p>
              </div>
              <p className={`mt-1 text-sm ${neutral}`}>
                {[
                  sale.modelYear ? `${sale.modelYear} model` : null,
                  sale.vendor,
                  formatSaleDate(sale.saleDate),
                  sale.place,
                  sale.sourceName,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {sale.lotUrl ? (
                <a
                  href={sale.lotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm underline underline-offset-2"
                >
                  Auction listing
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {guide.truncated ? (
        <p className={`mt-3 text-xs ${neutral}`}>
          This guide uses the {guide.overallCount} most recent matching sales on file.
        </p>
      ) : null}

      <p className={`mt-4 text-xs ${neutral}`}>{guide.sourceLine}</p>
      {guide.disclaimer ? (
        <p className={`mt-1 text-xs ${neutral}`}>{guide.disclaimer}</p>
      ) : null}

      {variant === "staff" ? (
        <details className="mt-4 text-sm">
          <summary className={`cursor-pointer ${neutral}`}>Auction sources</summary>
          <ul className="mt-3 flex flex-col gap-3">
            {guide.researchedSources.map((source) => (
              <li key={source.id}>
                <p className="font-medium text-foreground">
                  {source.name}{" "}
                  <span className={`font-normal ${neutral}`}>
                    ({source.connectionLabel})
                  </span>
                </p>
                <p className={`mt-1 ${neutral}`}>{source.covers}</p>
              </li>
            ))}
          </ul>
          <p className={`mt-3 ${neutral}`}>{guide.appraisalNote}</p>
        </details>
      ) : null}
    </section>
  );
}
