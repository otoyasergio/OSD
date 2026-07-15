import Link from "next/link";

type Props = {
  address: string | null;
  dateOfBirth: string | null;
  editHref: string;
  openInNewTab?: boolean;
  className?: string;
};

export function CustomerInformationReminder({
  address,
  dateOfBirth,
  editHref,
  openInNewTab = false,
  className = "",
}: Props) {
  const needsAddress = !address?.trim();
  const needsBirthday = !dateOfBirth;

  if (!needsAddress && !needsBirthday) return null;

  const title =
    needsAddress && needsBirthday
      ? "Customer information needed"
      : needsAddress
        ? "Customer address needed"
        : "Customer birthday needed";
  const requestedInformation =
    needsAddress && needsBirthday
      ? "their full address, postal code, and birthday"
      : needsAddress
        ? "their full address and postal code"
        : "their birthday";

  return (
    <div
      className={`${className} rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm`.trim()}
      role="status"
    >
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[var(--status-warning-fg)]">
        Ask the customer for {requestedInformation}. Then{" "}
        <Link
          href={editHref}
          target={openInNewTab ? "_blank" : undefined}
          rel={openInNewTab ? "noreferrer" : undefined}
          className="font-medium underline underline-offset-2"
        >
          update the customer
        </Link>
        . Staff can continue if the information is unavailable.
      </p>
    </div>
  );
}
