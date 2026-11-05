export function EmptyBikeFrame({ label = "NO PHOTO" }: { label?: string }) {
  return (
    <div className="photo-action-card-placeholder">
      <svg viewBox="0 0 48 32" className="photo-action-card-bike" aria-hidden>
        <path
          d="M8 22c2-6 6-10 10-11 3 4 7 6 12 6 2 0 4-.4 6-1.2L40 22H8z"
          fill="currentColor"
          opacity="0.85"
        />
        <circle cx="16" cy="12" r="3" fill="currentColor" />
        <path d="M6 24h36v2H6z" fill="currentColor" opacity="0.7" />
      </svg>
      <span className="photo-action-card-nophoto">{label}</span>
    </div>
  );
}
