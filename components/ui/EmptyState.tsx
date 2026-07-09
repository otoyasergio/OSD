import Link from "next/link";
import type { ReactNode } from "react";

type EmptyVariant = "default" | "work-orders" | "jobs" | "photos" | "search";

type Props = {
  title?: string;
  description: string;
  action?: {
    href: string;
    label: string;
  };
  variant?: EmptyVariant;
  children?: ReactNode;
};

function EmptyIllustration({ variant }: { variant: EmptyVariant }) {
  if (variant === "default") return null;

  if (variant === "work-orders") {
    return (
      <svg
        className="empty-state-icon"
        viewBox="0 0 64 48"
        aria-hidden
      >
        <rect
          x="8"
          y="14"
          width="48"
          height="28"
          rx="4"
          fill="currentColor"
          opacity="0.12"
        />
        <path
          d="M14 30c2.5-7 7-12 12-13 3.5 4.5 8 7 14 7 2.5 0 5-.5 7-1.5L52 30H14z"
          fill="currentColor"
          opacity="0.35"
        />
        <circle cx="24" cy="18" r="3.5" fill="currentColor" opacity="0.4" />
        <path
          d="M10 34h44v2.5H10z"
          fill="currentColor"
          opacity="0.2"
        />
      </svg>
    );
  }

  if (variant === "jobs") {
    return (
      <svg className="empty-state-icon" viewBox="0 0 64 48" aria-hidden>
        <rect
          x="12"
          y="10"
          width="40"
          height="30"
          rx="3"
          fill="currentColor"
          opacity="0.12"
        />
        <path
          d="M20 18h24v2.5H20zm0 7h18v2.5H20zm0 7h14v2.5H20z"
          fill="currentColor"
          opacity="0.35"
        />
      </svg>
    );
  }

  if (variant === "photos") {
    return (
      <svg className="empty-state-icon" viewBox="0 0 64 48" aria-hidden>
        <rect
          x="10"
          y="12"
          width="44"
          height="28"
          rx="3"
          fill="currentColor"
          opacity="0.12"
        />
        <circle cx="24" cy="22" r="4" fill="currentColor" opacity="0.35" />
        <path
          d="M14 34l10-10 8 8 6-6 12 8H14z"
          fill="currentColor"
          opacity="0.3"
        />
      </svg>
    );
  }

  return (
    <svg className="empty-state-icon" viewBox="0 0 64 48" aria-hidden>
      <circle cx="28" cy="22" r="10" fill="currentColor" opacity="0.12" />
      <circle
        cx="28"
        cy="22"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.4"
      />
      <path
        d="M35 29l12 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  variant = "default",
  children,
}: Props) {
  return (
    <div className="empty-state">
      <EmptyIllustration variant={variant} />
      {title ? <p className="empty-state-title">{title}</p> : null}
      <p className={title ? "empty-state-desc" : undefined}>{description}</p>
      {action ? (
        <div className="empty-state-action">
          <Link href={action.href} className="btn btn-primary">
            {action.label}
          </Link>
        </div>
      ) : null}
      {children}
    </div>
  );
}
