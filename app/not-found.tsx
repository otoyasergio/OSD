import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">404</p>
      <h1 className="text-2xl font-semibold text-zinc-900">Page not found</h1>
      <p className="text-sm text-zinc-600">
        That link does not match a page in OTOMOTO. Check the URL or return to the
        dashboard.
      </p>
      <Link href="/dashboard" className="btn btn-primary">
        Go to dashboard
      </Link>
    </main>
  );
}
