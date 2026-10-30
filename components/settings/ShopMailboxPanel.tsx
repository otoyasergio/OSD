import { SubmitButton } from "@/components/forms/SubmitButton";
import { TORONTO_SHOP } from "@/lib/shop/toronto";

export function shopMailboxNotice(code: string | undefined): string | null {
  switch (code) {
    case "connected":
      return "Google mailbox connected. Customer email will send from this inbox.";
    case "forbidden":
      return "Only an owner can connect the shop mailbox.";
    case "oauth":
      return "Google sign-in is not set up on the server yet.";
    case "denied":
      return "Google sign-in was cancelled. Connect the shop mailbox to send customer email.";
    case "state":
      return "That connection attempt expired. Start it again.";
    case "location":
      return "Customer email connects for the Toronto shop only. Switch to Toronto, then try again.";
    case "exchange":
      return "Google did not finish connecting the mailbox. Try again.";
    default:
      return null;
  }
}

export function ShopMailboxPanel({
  oauthConfigured,
  locationAllowed,
  redirectUri,
  emailAddress,
  notice,
  disconnectAction,
}: {
  oauthConfigured: boolean;
  locationAllowed: boolean;
  redirectUri: string;
  emailAddress: string | null;
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
            data-testid="shop-mailbox-notice"
          >
            {notice}
          </p>
        ) : null}

        {emailAddress ? (
          <p className="text-sm text-foreground" data-testid="shop-mailbox-address">
            Customer email sends from <strong>{emailAddress}</strong> as{" "}
            {TORONTO_SHOP.legalName}. Replies come back to that inbox.
          </p>
        ) : (
          <p className="text-sm text-[var(--status-neutral)]">
            Connect the shop Google Workspace mailbox, such as info@torontomoto.com. Ready
            for pickup notices and other customer emails send from that account, with the
            sender name {TORONTO_SHOP.legalName}.
          </p>
        )}

        {locationAllowed && oauthConfigured ? (
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/google/mail/start"
              className="btn btn-primary"
              data-testid="shop-mailbox-connect"
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
          <div className="rounded border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm">
            <p className="font-semibold text-foreground">Google Cloud OAuth client</p>
            <p className="mt-1 text-[var(--status-neutral)]">
              In the shop Google Workspace, create an Internal Web client and enable the
              Gmail API. An Internal app keeps the connection from expiring after a week.
              Then set <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code>{" "}
              on the production server. Authorized redirect URI:
            </p>
            <p
              className="mt-2 break-all font-mono text-xs"
              data-testid="shop-mailbox-redirect"
            >
              {redirectUri}
            </p>
          </div>
        ) : null}

        {!locationAllowed ? (
          <p
            className="text-sm text-[var(--status-neutral)]"
            data-testid="shop-mailbox-location"
          >
            Switch the active location to Toronto before connecting the mailbox. Ottawa is
            not an operating shop.
          </p>
        ) : null}
      </div>
    </section>
  );
}
