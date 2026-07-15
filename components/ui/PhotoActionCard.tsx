import Link from "next/link";
import { Flag } from "lucide-react";
import { StageChip, type StageChipTone } from "@/components/ui/StageChip";

export function PhotoActionCard({
  href,
  photoUrl,
  title,
  subtitle,
  stageLabel,
  stageTone = "teal",
  primaryLabel = "Open",
  badges = [],
  flagged = false,
  compact = false,
}: {
  href: string;
  photoUrl?: string | null;
  title: string;
  subtitle: string;
  stageLabel: string;
  stageTone?: StageChipTone;
  primaryLabel?: string;
  badges?: string[];
  flagged?: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={[
        "photo-action-card",
        compact ? "photo-action-card--compact" : "",
        flagged ? "photo-action-card--flagged" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="photo-action-card-media" aria-hidden={!photoUrl}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
          <img src={photoUrl} alt="" className="photo-action-card-img" loading="lazy" />
        ) : (
          <div className="photo-action-card-placeholder">
            <svg viewBox="0 0 48 32" className="photo-action-card-bike" aria-hidden>
              <path
                d="M8 22c2-6 6-10 10-11 3 4 7 6 12 6 2 0 4-.4 6-1.2L40 22H8z"
                fill="currentColor"
                opacity="0.4"
              />
              <circle cx="16" cy="12" r="3" fill="currentColor" opacity="0.5" />
              <path d="M6 24h36v2H6z" fill="currentColor" opacity="0.3" />
            </svg>
          </div>
        )}
      </div>
      <div className="photo-action-card-body">
        <div className="photo-action-card-top">
          <p className="photo-action-card-title">{title}</p>
          <StageChip label={stageLabel} tone={stageTone} />
        </div>
        <p className="photo-action-card-subtitle">{subtitle}</p>
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
