import Link from "next/link";

type Props = {
  phone: string | null;
  email: string | null;
  address: string | null;
  dateOfBirth: string | null;
  editHref: string;
  openInNewTab?: boolean;
  className?: string;
};

export function CustomerInformationReminder({
  phone,
  email,
  address,
  dateOfBirth,
  editHref,
  openInNewTab = false,
  className = "",
}: Props) {
  const missingItems = [
    !phone?.trim() ? { label: "phone number", title: "Customer phone number needed" } : null,
    !email?.trim() ? { label: "email address", title: "Customer email needed" } : null,
    !address?.trim()
      ? { label: "full address and postal code", title: "Customer address needed" }
      : null,
    !dateOfBirth ? { label: "birthday", title: "Customer birthday needed" } : null,
  ].filter((item): item is { label: string; title: string } => item !== null);

  if (missingItems.length === 0) return null;

  const title =
    missingItems.length === 1 ? missingItems[0].title : "Customer information needed";
  const labels = missingItems.map((item) => item.label);
  const requestedInformation =
    labels.length === 1
      ? labels[0]
      : labels.length === 2
        ? `${labels[0]} and ${labels[1]}`
        : `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;

  return (
    <div
      className={`${className} rounded-lg border border-[var(--status-warning)] bg-[var(--status-warning-bg)] px-4 py-3 text-sm`.trim()}
      role="status"
    >
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[var(--status-warning-fg)]">
        Ask the customer for their {requestedInformation}. Then{" "}
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
