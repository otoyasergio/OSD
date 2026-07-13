export default function WorkOrderLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading work order">
      <div className="h-10 w-64 animate-pulse rounded bg-zinc-200" />
      <div className="h-12 animate-pulse rounded bg-zinc-100" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50" />
        <div className="h-48 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50" />
      </div>
    </div>
  );
}
