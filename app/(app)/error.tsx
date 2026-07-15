"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card card-pad mx-auto mt-8 max-w-lg text-center">
      <h1 className="text-lg font-semibold text-foreground">Page error</h1>
      <p className="mt-2 text-sm text-[var(--status-neutral)]">
        This screen could not be loaded. Your session is still active — try again or open
        another page from the sidebar.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-[var(--chrome-muted)]">
          Reference: {error.digest}
        </p>
      ) : null}
      <button type="button" onClick={reset} className="btn btn-primary mt-4">
        Try again
      </button>
    </div>
  );
}
