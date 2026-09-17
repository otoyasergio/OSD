import Link from "next/link";
import { redirect } from "next/navigation";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canManageInspectionTemplate } from "@/lib/permissions";
import { listInspectionTemplateItems } from "@/lib/services/inspectionTemplate";
import {
  InspectionTemplateCreateForm,
  InspectionTemplateEditForm,
} from "@/components/forms/InspectionTemplateForms";
import {
  createTemplateItemAction,
  swapTemplateItemOrderAction,
  toggleTemplateItemActiveAction,
  updateTemplateItemAction,
} from "@/app/(app)/settings/inspection_template/actions";

export const dynamic = "force-dynamic";

export default async function InspectionTemplatePage() {
  const preview = await getRolePreviewContext();
  if (!preview) redirect("/login");
  if (!canManageInspectionTemplate(preview.role)) redirect("/dashboard");

  const items = await listInspectionTemplateItems({ includeInactive: true });
  const nextDisplayOrder =
    items.reduce((max, item) => Math.max(max, item.display_order), 0) + 10;

  const byCategory = items.reduce<Record<string, typeof items>>((acc, item) => {
    const key = item.category;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/settings"
          className="text-sm text-[var(--status-neutral)] underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Inspection template
        </h1>
        <p className="mt-1 text-sm text-[var(--status-neutral)]">
          Changes apply to new inspections only. Existing work orders keep their
          snapshots. Items are never deleted.
        </p>
      </div>

      <InspectionTemplateCreateForm
        action={createTemplateItemAction}
        nextDisplayOrder={nextDisplayOrder}
      />

      <div className="flex flex-col gap-6">
        {Object.entries(byCategory).map(([category, categoryItems]) => (
          <section key={category}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--status-neutral)]">
              {category}
            </h2>
            <div className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-white">
              {categoryItems.map((item, index) => {
                const prev = categoryItems[index - 1];
                const next = categoryItems[index + 1];
                return (
                  <details key={item.template_item_id} className="px-4 py-3">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                      <span className="font-medium text-foreground">
                        {item.item_name}
                        {item.active ? null : (
                          <span className="ml-2 rounded bg-[var(--border)] px-2 py-0.5 text-xs font-semibold text-foreground">
                            Inactive
                          </span>
                        )}
                        {item.requires_measurement ? (
                          <span className="ml-2 text-xs font-normal text-[var(--status-neutral)]">
                            measurement
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-[var(--status-neutral)]">
                        order {item.display_order}
                      </span>
                    </summary>

                    <InspectionTemplateEditForm
                      action={updateTemplateItemAction.bind(null, item.template_item_id)}
                      item={item}
                    />

                    <div className="flex flex-wrap gap-2 pt-3">
                      {prev ? (
                        <form
                          action={swapTemplateItemOrderAction.bind(
                            null,
                            item.template_item_id,
                            prev.template_item_id
                          )}
                        >
                          <button
                            type="submit"
                            className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-[var(--surface-muted)]"
                          >
                            Move up
                          </button>
                        </form>
                      ) : null}
                      {next ? (
                        <form
                          action={swapTemplateItemOrderAction.bind(
                            null,
                            item.template_item_id,
                            next.template_item_id
                          )}
                        >
                          <button
                            type="submit"
                            className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-[var(--surface-muted)]"
                          >
                            Move down
                          </button>
                        </form>
                      ) : null}
                      <form
                        action={toggleTemplateItemActiveAction.bind(
                          null,
                          item.template_item_id,
                          !item.active
                        )}
                      >
                        <button
                          type="submit"
                          className="min-h-11 rounded border border-[var(--border-strong)] bg-white px-4 py-2 text-sm font-semibold text-foreground hover:bg-[var(--surface-muted)]"
                        >
                          {item.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
