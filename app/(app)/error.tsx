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
      <h1 className="text-lg font-semibold text-zinc-900">Page error</h1>
      <p className="mt-2 text-sm text-zinc-600">
        This screen could not be loaded. Your session is still active — try again or open
        another page from the sidebar.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-zinc-400">Reference: {error.digest}</p>
      ) : null}
      <button type="button" onClick={reset} className="btn btn-primary mt-4">
        Try again
      </button>
    </div>
  );
}
