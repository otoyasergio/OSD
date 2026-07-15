"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-[var(--status-neutral)]">
        We could not load this page. Please try again. If the problem continues, contact
        an owner.
      </p>
      {error.digest ? (
        <p className="text-xs text-[var(--chrome-muted)]">Reference: {error.digest}</p>
      ) : null}
      <button type="button" onClick={reset} className="btn btn-primary">
        Try again
      </button>
    </main>
  );
}
