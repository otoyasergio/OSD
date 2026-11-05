import Link from "next/link";
import { Flag } from "lucide-react";
import { RecoverableSignedImage } from "@/components/photos/RecoverableSignedImage";
import { EmptyBikeFrame } from "@/components/ui/EmptyBikeFrame";
import { StageChip, type StageChipTone } from "@/components/ui/StageChip";

export function PhotoActionCard({
  href,
  photoUrl,
  title,
  customerName,
  subtitle,
  stageLabel,
  stageTone = "teal",
  primaryLabel = "Open",
  badges = [],
  flagged = false,
  compact = false,
  technicianName = null,
}: {
  href: string;
  photoUrl?: string | null;
  title: string;
  /** Client name, on its own line under the bike. */
  customerName?: string | null;
  subtitle: string;
  stageLabel: string;
  stageTone?: StageChipTone;
  primaryLabel?: string;
  badges?: string[];
  flagged?: boolean;
  compact?: boolean;
  technicianName?: string | null;
}) {
  const techInitials = technicianName
    ? technicianName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.slice(0, 1).toUpperCase())
        .join("")
    : "";

  return (
    <Link
      href={href}
      draggable={false}
      className={[
        "photo-action-card",
        "td-enter",
        compact ? "photo-action-card--compact" : "",
        flagged ? "photo-action-card--flagged" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="photo-action-card-media" aria-hidden={!photoUrl}>
        {subtitle ? <span className="photo-action-card-ticket">{subtitle}</span> : null}
        {photoUrl ? (
          <RecoverableSignedImage
            src={photoUrl}
            alt=""
            className="photo-action-card-img"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <EmptyBikeFrame />
        )}
      </div>
      <div className="photo-action-card-body">
        <div className="photo-action-card-top">
          <p className="photo-action-card-title">{title}</p>
          <StageChip label={stageLabel} tone={stageTone} />
        </div>
        {customerName || techInitials ? (
          <div className="flex items-center gap-2">
            {customerName ? (
              <p className="photo-action-card-customer">{customerName}</p>
            ) : null}
            {techInitials ? (
              <span
                className="photo-action-card-tech"
                title={technicianName ?? undefined}
              >
                {techInitials}
              </span>
            ) : null}
          </div>
        ) : null}
        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge}
                className="badge bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] ring-1 ring-[var(--status-warning)]/20"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
        <div className="photo-action-card-actions">
          <span className="photo-action-card-primary">{primaryLabel}</span>
          {flagged ? (
            <span className="photo-action-card-flag" aria-label="Flagged">
              <Flag size={16} strokeWidth={2.25} />
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
