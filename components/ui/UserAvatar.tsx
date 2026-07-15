type Props = {
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-24 w-24 text-2xl",
};

export function UserAvatar({
  firstName,
  lastName,
  photoUrl,
  size = "md",
  className = "",
}: Props) {
  const name = `${firstName} ${lastName}`.trim();
  const initials = `${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase();

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--surface-muted)] font-semibold text-foreground ${SIZE_CLASSES[size]} ${className}`.trim()}
      aria-label={photoUrl ? `${name} profile photo` : `${name} initials`}
    >
      {photoUrl ? (
        // Signed Supabase Storage URLs are short-lived and cannot be configured as a static Next image host.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initials || "?"}</span>
      )}
    </span>
  );
}
