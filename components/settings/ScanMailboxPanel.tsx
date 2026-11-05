import { SubmitButton } from "@/components/forms/SubmitButton";
import { SCAN_REPORT_ADDRESS, type ScanOutcome } from "@/lib/email/scanReport";

const OUTCOME_LABEL: Record<ScanOutcome, string> = {
  codes: "Codes found",
  no_codes: "No fault codes",
  no_connection: "No connection",
  needs_confirmation: "Needs a look",
};

export function scanMailboxNotice(code: string | undefined): string | null {
  switch (code) {
    case "connected":
      return "Scan mailbox connected. TopGuru scan reports sent there stay in the shop.";
    case "customer_mailbox":
      return "That address sends customer email. Scan reports use scans@torontomoto.com.";
    case "wrong_address":
      return "Scan reports go to scans@torontomoto.com. Sign in as that user.";
    case "forbidden":
      return "Only an owner can connect the scan mailbox.";
    case "oauth":
      return "Google sign-in is not set up on the server yet.";
    case "denied":
      return "Google sign-in was cancelled. Connect the scans mailbox to receive TopGuru reports.";
    case "state":
      return "That connection attempt expired. Start it again.";
    case "location":
      return "Scan reports connect for the Toronto shop only. Switch to Toronto, then try again.";
    case "exchange":
      return "Google did not finish connecting the mailbox. Try again.";
    default:
      return null;
  }
}

export function ScanMailboxPanel({
  oauthConfigured,
  locationAllowed,
  emailAddress,
  reports,
  notice,
  disconnectAction,
}: {
  oauthConfigured: boolean;
  locationAllowed: boolean;
  emailAddress: string | null;
  reports: Array<{
    subject: string;
    outcome: ScanOutcome;
    workOrderNumber: string | null;
    onBike: boolean;
  }>;
  notice: string | null;
  disconnectAction: () => Promise<void>;
}) {
  return (
    <section className="card">
      <div className="card-body flex flex-col gap-4">
        {notice ? (
          <p
            className="text-sm text-foreground"
            role="status"
            data-testid="scan-mailbox-notice"
          >
            {notice}
          </p>
        ) : null}

        <p className="text-sm text-foreground" data-testid="scan-mailbox-address">
          TopGuru sends scan reports to <strong>{SCAN_REPORT_ADDRESS}</strong>. Customers
          do not receive this mail.
        </p>
        {emailAddress ? (
          <p className="text-sm text-[var(--status-neutral)]">
            This shop is connected to that inbox.
          </p>
        ) : (
          <p className="text-sm text-[var(--status-neutral)]">
            Create the Google Workspace user {SCAN_REPORT_ADDRESS}, then connect it here.
            Sign in as that user.
          </p>
        )}

        {locationAllowed && oauthConfigured ? (
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/google/scan-mail/start"
              className="btn btn-primary"
              data-testid="scan-mailbox-connect"
            >
              {emailAddress ? "Reconnect Google" : "Connect Google"}
            </a>
            {emailAddress ? (
              <form action={disconnectAction}>
                <SubmitButton
                  label="Disconnect"
                  pendingLabel="Disconnecting…"
                  variant="danger"
                />
              </form>
            ) : null}
          </div>
        ) : null}

        {locationAllowed && !oauthConfigured ? (
          <p className="text-sm text-[var(--status-neutral)]">
            Google sign-in uses the same OAuth client as customer email. The scan
            connection asks only for permission to read this mailbox.
          </p>
        ) : null}

        {!locationAllowed ? (
          <p className="text-sm text-[var(--status-neutral)]">
            Switch the active location to Toronto before connecting the scan mailbox.
          </p>
        ) : null}

        {emailAddress ? (
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Reports from this mailbox
            </h2>
            {reports.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--status-neutral)]">
                No scan reports yet.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {reports.map((report) => (
                  <li
                    key={`${report.subject}-${report.workOrderNumber ?? "open"}`}
                    className="text-sm"
                  >
                    <span className="text-foreground">{report.subject}</span>
                    <span className="text-[var(--status-neutral)]">
                      {" "}
                      · {OUTCOME_LABEL[report.outcome]} ·{" "}
                      {report.workOrderNumber ??
                        (report.onBike ? "Bike profile" : "Not matched")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
