export default function PassportUnavailable() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center px-4 py-12">
      <section className="w-full rounded-lg border border-[var(--border)] bg-white p-6 text-center">
        <h1 className="text-xl font-semibold">Passport link unavailable</h1>
        <p className="mt-2 text-sm text-[var(--status-neutral)]">
          This link is invalid, expired, revoked, or replaced. Ask the person who shared
          it—or OTOMOTO—to issue a current copy.
        </p>
      </section>
    </main>
  );
}
