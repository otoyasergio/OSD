"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--surface-muted)] px-4">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <p className="max-w-md text-center text-sm text-[var(--status-neutral)]">
            An unexpected error occurred. You can try again or return to the dashboard.
          </p>
          {error.digest ? (
            <p className="text-xs text-[var(--chrome-muted)]">
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-[var(--chrome)] px-4 py-2 text-sm font-medium text-white"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
