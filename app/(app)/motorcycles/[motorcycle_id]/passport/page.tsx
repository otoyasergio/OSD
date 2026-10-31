import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createPassportShareAction,
  publishVehiclePassportAction,
  revokePassportShareAction,
} from "@/app/(app)/motorcycles/[motorcycle_id]/passport/actions";
import { PassportPublishForm } from "@/components/passport/PassportPublishForm";
import { PassportReport } from "@/components/passport/PassportReport";
import { PassportShareControls } from "@/components/passport/PassportShareControls";
import { requireUser } from "@/lib/auth/session";
import { createPassportReview } from "@/lib/passport/review";
import { canManageVehiclePassport } from "@/lib/permissions";
import {
  getVehiclePassportManagement,
  type VehiclePassportManagement,
} from "@/lib/services/passportShare";
import { toFormErrorMessage } from "@/lib/services/errors";
import { getMotorcycleById } from "@/lib/services/motorcycles";
import {
  previewVehiclePassport,
  type VehiclePassportDraft,
} from "@/lib/services/vehiclePassport";

type PreviewResult =
  { draft: VehiclePassportDraft; error: null } | { draft: null; error: string };

async function loadPreview(motorcycleId: string): Promise<PreviewResult> {
  try {
    return {
      draft: await previewVehiclePassport(motorcycleId),
      error: null,
    };
  } catch (error) {
    return { draft: null, error: toFormErrorMessage(error) };
  }
}

export default async function VehiclePassportPage({
  params,
}: {
  params: Promise<{ motorcycle_id: string }>;
}) {
  const { motorcycle_id } = await params;
  const user = await requireUser();
  if (!canManageVehiclePassport(user.role)) redirect("/dashboard");

  const [motorcycle, preview, management]: [
    Awaited<ReturnType<typeof getMotorcycleById>>,
    PreviewResult,
    VehiclePassportManagement,
  ] = await Promise.all([
    getMotorcycleById(motorcycle_id),
    loadPreview(motorcycle_id),
    getVehiclePassportManagement(motorcycle_id),
  ]);
  if (!motorcycle) notFound();

  const bikeLabel = `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`;
  const publishAction = preview.draft
    ? publishVehiclePassportAction.bind(
        null,
        motorcycle_id,
        createPassportReview(preview.draft)
      )
    : null;
  const currentSnapshot = management.currentSnapshot;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link
          href={`/motorcycles/${motorcycle_id}`}
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← {bikeLabel}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Vehicle passport
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--status-neutral)]">
          Review the exact service-only record before publishing. Contact details,
          communications, prices, invoices, payments, contracts, notes, documents, and
          photos are not part of this passport.
        </p>
      </header>

      {currentSnapshot ? (
        <>
          <section>
            <h2 className="text-lg font-semibold">Current published version</h2>
            <p className="mt-1 text-sm text-[var(--status-neutral)]">
              {management.passport?.passport_number} · Version {currentSnapshot.version}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold underline-offset-2 hover:underline">
                Review published record
              </summary>
              <div className="mt-3">
                <PassportReport payload={currentSnapshot.payload} titleLevel={2} />
              </div>
            </details>
          </section>

          <PassportShareControls
            createAction={createPassportShareAction.bind(
              null,
              motorcycle_id,
              currentSnapshot.snapshot_id
            )}
            revokeAction={revokePassportShareAction.bind(null, motorcycle_id)}
            shares={management.shares}
          />
        </>
      ) : (
        <section className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-5">
          <h2 className="font-semibold">No published passport yet</h2>
          <p className="mt-1 text-sm text-[var(--status-neutral)]">
            Publish the reviewed preview below before creating a share link.
          </p>
        </section>
      )}

      <section>
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">Publication preview</h2>
            <p className="mt-1 text-sm text-[var(--status-neutral)]">
              This preview is rebuilt from completed OTOMOTO jobs. Publishing a
              replacement revokes links to the prior version.
            </p>
          </div>
          {!preview.draft ? (
            <p
              role="alert"
              className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {preview.error ?? "The passport preview is unavailable."}
            </p>
          ) : (
            <>
              <PassportPublishForm
                action={publishAction!}
                reportVersion={preview.draft.reportVersion}
                replacesPublishedVersion={Boolean(currentSnapshot)}
              />
              <PassportReport payload={preview.draft.payload} titleLevel={2} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
