import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/auth/session";
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
  const user = await getCurrentAppUser();
  if (!user) redirect("/login");
  if (!canManageInspectionTemplate(user.role)) redirect("/dashboard");

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
          className="text-sm text-zinc-600 underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Inspection template
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
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
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              {category}
            </h2>
            <div className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
              {categoryItems.map((item, index) => {
                const prev = categoryItems[index - 1];
                const next = categoryItems[index + 1];
                return (
                  <details key={item.template_item_id} className="px-4 py-3">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                      <span className="font-medium text-zinc-900">
                        {item.item_name}
                        {item.active ? null : (
                          <span className="ml-2 rounded bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                            Inactive
                          </span>
                        )}
                        {item.requires_measurement ? (
                          <span className="ml-2 text-xs font-normal text-zinc-500">
                            measurement
                          </span>
                        ) : null}
                      </span>
                      <span className="text-sm text-zinc-600">
                        order {item.display_order}
                      </span>
                    </summary>

                    <InspectionTemplateEditForm
                      action={updateTemplateItemAction.bind(
                        null,
                        item.template_item_id
                      )}
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
                            className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
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
                            className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
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
                          className="min-h-11 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
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
