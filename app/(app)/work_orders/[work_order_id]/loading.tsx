export default function WorkOrderLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading work order">
      <div className="h-10 w-64 animate-pulse rounded bg-[var(--border)]" />
      <div className="h-12 animate-pulse rounded bg-[var(--surface-muted)]" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]" />
        <div className="h-48 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]" />
      </div>
    </div>
  );
}
