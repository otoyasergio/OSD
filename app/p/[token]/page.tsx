import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { PassportPrintButton } from "@/components/passport/PassportPrintButton";
import { PassportReport } from "@/components/passport/PassportReport";
import { resolvePublicPassportShare } from "@/lib/services/passportShare";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Vehicle Service Passport | OTOMOTO",
  description: "A controlled OTOMOTO vehicle service-history snapshot.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Toronto",
    timeZoneName: "short",
  }).format(new Date(value));
}

export default async function PublicPassportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  noStore();
  const { token } = await params;
  const share = await resolvePublicPassportShare(token);
  if (!share) notFound();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10 print:max-w-none print:p-0">
      <section className="passport-public-controls rounded border border-[var(--border)] bg-white p-4 print:hidden">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-semibold">Controlled service-history copy</h2>
            <p className="mt-1 text-sm text-[var(--status-neutral)]">
              Access expires {formatExpiry(share.expiresAt)}. Revocation stops future
              access to this page but cannot recall a saved copy.
            </p>
          </div>
          <PassportPrintButton />
        </div>
      </section>

      <PassportReport payload={share.payload} showDownloadNotice />
    </main>
  );
}
