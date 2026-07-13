export default function AppLoading() {
  return (
    <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-[var(--border)]" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]"
          />
        ))}
      </div>
    </div>
  );
}
