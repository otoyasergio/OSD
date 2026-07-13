import Link from "next/link";
import type { GarageBikeCard } from "@/lib/services/clientGarage";

function BikeSilhouette() {
  return (
    <svg viewBox="0 0 48 32" className="wo-card-photo-placeholder-icon" aria-hidden>
      <path
        d="M8 22c2-6 6-10 10-11 3 4 7 6 12 6 2 0 4-.4 6-1.2L40 22H8z"
        fill="currentColor"
        opacity="0.35"
      />
      <circle cx="16" cy="12" r="3" fill="currentColor" opacity="0.45" />
      <path d="M6 24h36v2H6z" fill="currentColor" opacity="0.25" />
    </svg>
  );
}

export function GarageBikeCardView({
  bike,
  showTransfer = false,
}: {
  bike: GarageBikeCard;
  showTransfer?: boolean;
}) {
  const label = `${bike.year} ${bike.make} ${bike.model}`;
  const colour = bike.colour?.trim() || "Colour not set";
  const vinLabel = bike.vin?.trim() || null;
  const transferHref = `/motorcycles/${bike.motorcycle_id}#transfer-ownership`;

  return (
    <article className="wo-card wo-card-photo garage-card">
      <Link href={bike.href} className="garage-card-main" aria-label={`View ${label}`}>
        <div className="wo-card-strip wo-card-strip-neutral" aria-hidden />
        <div className="wo-card-photo-frame" aria-hidden={!bike.primary_photo_url}>
          {bike.primary_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
            <img
              src={bike.primary_photo_url}
              alt=""
              className="wo-card-photo-img"
              loading="lazy"
            />
          ) : (
            <div className="wo-card-photo-placeholder">
              <BikeSilhouette />
            </div>
          )}
        </div>
        <div className="wo-card-body">
          <div className="wo-card-hero">
            <p className="wo-card-bike">{label}</p>
            <p className="wo-card-meta">{colour}</p>
          </div>
          <div className="wo-card-footer">
            {bike.missing_vin ? (
              <span className="garage-card-vin-warn">Missing VIN</span>
            ) : (
              <p className="garage-card-vin" title={vinLabel ?? undefined}>
                VIN {vinLabel}
              </p>
            )}
            <p className="wo-card-next-action">
              <span className="wo-card-next-label">Open</span> motorcycle profile
            </p>
          </div>
        </div>
      </Link>
      {showTransfer ? (
        <div className="garage-card-actions">
          <Link href={transferHref} className="garage-card-transfer">
            Transfer
          </Link>
        </div>
      ) : null}
    </article>
  );
}

export function ClientGarage({
  customerId,
  bikes,
  canTransfer = false,
}: {
  customerId: string;
  bikes: GarageBikeCard[];
  canTransfer?: boolean;
}) {
  const addHref = `/motorcycles/new?customer_id=${customerId}`;

  return (
    <section className="garage-section" aria-labelledby="client-garage-heading">
      <div className="garage-section-header">
        <div>
          <h2
            id="client-garage-heading"
            className="text-lg font-semibold text-foreground"
          >
            Client garage
          </h2>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Motorcycles on file for this customer.
          </p>
        </div>
        <Link href={addHref} className="btn btn-primary">
          Add to garage
        </Link>
      </div>

      {bikes.length === 0 ? (
        <div className="garage-empty">
          <p className="garage-empty-title">No bikes in this garage yet</p>
          <p className="garage-empty-copy">
            Add the first motorcycle to keep intake photos and service history together.
          </p>
          <Link href={addHref} className="btn btn-accent mt-4">
            Add motorcycle
          </Link>
        </div>
      ) : (
        <div className="wo-cards-view garage-grid">
          {bikes.map((bike) => (
            <GarageBikeCardView
              key={bike.motorcycle_id}
              bike={bike}
              showTransfer={canTransfer}
            />
          ))}
        </div>
      )}
    </section>
  );
}
