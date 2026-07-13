export default function DashboardLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="flex items-center justify-between gap-3">
        <div className="h-8 w-40 animate-pulse rounded bg-zinc-200" />
        <div className="h-9 w-28 animate-pulse rounded bg-zinc-200" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="min-w-[220px] flex-1 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
          >
            <div className="h-5 w-24 animate-pulse rounded bg-zinc-200" />
            <div className="h-20 animate-pulse rounded bg-zinc-100" />
            <div className="h-20 animate-pulse rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
