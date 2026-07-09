"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toFormErrorMessage } from "@/lib/services/errors";
import {
  buildDashboardHref,
  deleteDashboardView,
  saveDashboardView,
  setDashboardDensityPreference,
  setHiddenBoardColumnsPreference,
  type DashboardViewParams,
} from "@/lib/services/userPreferences";
import { SHOP_BOARD_COLUMNS } from "@/lib/status/pipeline";

export type ViewFormState = { error: string | null };

function readParamsFromForm(formData: FormData): DashboardViewParams {
  const pick = (key: string) => {
    const value = String(formData.get(key) ?? "").trim();
    return value || undefined;
  };
  return {
    view: pick("view"),
    status: pick("status"),
    technician_id: pick("technician_id"),
    flag: pick("flag"),
    q: pick("q"),
    hide_empty: pick("hide_empty"),
    density: pick("density"),
    card: pick("card"),
  };
}

export async function saveDashboardViewAction(
  _prevState: ViewFormState,
  formData: FormData
): Promise<ViewFormState> {
  try {
    await saveDashboardView(
      String(formData.get("name") ?? ""),
      readParamsFromForm(formData)
    );
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/dashboard");
  return { error: null };
}

export async function deleteDashboardViewAction(
  viewId: string
): Promise<ViewFormState> {
  try {
    await deleteDashboardView(viewId);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/dashboard");
  return { error: null };
}

export async function applySavedDashboardViewAction(
  formData: FormData
): Promise<void> {
  const params = readParamsFromForm(formData);
  redirect(buildDashboardHref(params));
}

export async function setDashboardDensityAction(
  density: "compact" | "comfortable"
): Promise<ViewFormState> {
  try {
    await setDashboardDensityPreference(density);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/dashboard");
  return { error: null };
}

export async function setHiddenBoardColumnsAction(
  formData: FormData
): Promise<ViewFormState> {
  try {
    const visible = new Set(
      formData
        .getAll("visible_columns")
        .map((value) => String(value))
        .filter(Boolean)
    );
    const hidden = SHOP_BOARD_COLUMNS.map((column) => column.id).filter(
      (id) => !visible.has(id)
    );
    await setHiddenBoardColumnsPreference(hidden);
  } catch (error) {
    return { error: toFormErrorMessage(error) };
  }
  revalidatePath("/dashboard");
  return { error: null };
}
