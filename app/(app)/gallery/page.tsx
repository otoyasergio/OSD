import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canViewClients, isFloorTech, staffHomePath } from "@/lib/permissions";
import {
  listShopGalleryPhotos,
  SHOP_GALLERY_PAGE_SIZE,
} from "@/lib/services/photoGallery";
import type { GalleryPhotoGroup } from "@/lib/photos/galleryGroups";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffPhotoGrid } from "@/components/photos/StaffPhotoGrid";

export const dynamic = "force-dynamic";

const GROUPS: Array<{ id: GalleryPhotoGroup; label: string }> = [
  { id: "all", label: "All" },
  { id: "intake", label: "Intake" },
  { id: "inspection", label: "Inspection" },
  { id: "after", label: "After" },
];

function parseGroup(value: string | undefined): GalleryPhotoGroup {
  if (value === "intake" || value === "inspection" || value === "after") return value;
  return "all";
}

export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string; before?: string }>;
}) {
  const user = await requireUser();
  const preview = await getRolePreviewContext();
  const viewRole = preview?.role ?? user.role;
  if (isFloorTech(viewRole)) redirect(staffHomePath(viewRole));
  if (!canViewClients(viewRole)) redirect("/dashboard");

  const params = await searchParams;
  const group = parseGroup(params.group);
  const q = params.q?.trim() ?? "";
  const before = params.before?.trim() || null;

  const { photos, hasMore } = await listShopGalleryPhotos({
    group,
    q,
    before,
    limit: SHOP_GALLERY_PAGE_SIZE,
  });

  const nextBefore = hasMore ? photos[photos.length - 1]?.created_at : null;

  function hrefFor(overrides: {
    group?: GalleryPhotoGroup;
    q?: string;
    before?: string | null;
  }) {
    const next = new URLSearchParams();
    const nextGroup = overrides.group ?? group;
    const nextQ = overrides.q ?? q;
    if (nextGroup !== "all") next.set("group", nextGroup);
    if (nextQ) next.set("q", nextQ);
    if (overrides.before) next.set("before", overrides.before);
    const qs = next.toString();
    return qs ? `/gallery?${qs}` : "/gallery";
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Gallery"
        subtitle="Every intake, inspection, and after photo at this shop — newest first."
      />

      <form method="get" className="filter-panel sm:grid-cols-1 lg:grid-cols-2">
        {group !== "all" ? <input type="hidden" name="group" value={group} /> : null}
        <label className="block text-sm font-medium text-foreground">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="WO number, bike, plate, or customer"
            className="mt-1.5 min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground"
          />
        </label>
        <div className="flex items-end">
          <button type="submit" className="btn btn-secondary min-h-11">
            Search
          </button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Photo type">
        {GROUPS.map((entry) => {
          const active = entry.id === group;
          return (
            <Link
              key={entry.id}
              href={hrefFor({ group: entry.id, before: null })}
              className={["btn min-h-10", active ? "btn-primary" : "btn-secondary"].join(
                " "
              )}
              aria-current={active ? "page" : undefined}
            >
              {entry.label}
            </Link>
          );
        })}
      </div>

      <StaffPhotoGrid
        photos={photos}
        mode="gallery"
        emptyMessage="No photos at this shop yet. Intake, inspection, and after shots show up here when visits get them."
      />

      {nextBefore ? (
        <div className="flex justify-center">
          <Link href={hrefFor({ before: nextBefore })} className="btn btn-secondary">
            Older photos
          </Link>
        </div>
      ) : null}
    </div>
  );
}
