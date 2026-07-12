import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canManageInspectionTemplate } from "@/lib/permissions";
import { inspectionTemplateItemSchema } from "@/lib/validation/schemas";

export type InspectionTemplateItem = {
  template_item_id: string;
  category: string;
  item_name: string;
  display_order: number;
  requires_measurement: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type InspectionTemplateItemInput = {
  category: string;
  item_name: string;
  display_order: number;
  requires_measurement?: boolean;
  active?: boolean;
};

const COLUMNS =
  "template_item_id, category, item_name, display_order, requires_measurement, active, created_at, updated_at";

export async function listInspectionTemplateItems(
  options: { includeInactive?: boolean } = {}
): Promise<InspectionTemplateItem[]> {
  await requireUser();
  const supabase = await createClient();

  let query = supabase.from("inspection_template_item").select(COLUMNS);
  if (!options.includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query
    .order("display_order")
    .order("category")
    .order("item_name");
  if (error) throw error;
  return (data ?? []) as InspectionTemplateItem[];
}

async function requireTemplateManager() {
  const user = await requireUser();
  if (!canManageInspectionTemplate(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export async function createInspectionTemplateItem(
  input: InspectionTemplateItemInput
): Promise<InspectionTemplateItem> {
  const user = await requireTemplateManager();
  const parsed = inspectionTemplateItemSchema.parse(input);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_template_item")
    .insert({
      category: parsed.category,
      item_name: parsed.item_name,
      display_order: parsed.display_order,
      requires_measurement: parsed.requires_measurement,
      active: parsed.active,
    })
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const item = data as InspectionTemplateItem;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "inspection_template_item_created",
    entity_type: "inspection_template_item",
    entity_id: item.template_item_id,
    description: `Inspection item ${item.category} / ${item.item_name} created`,
    new_value: item,
  });

  return item;
}

export async function updateInspectionTemplateItem(
  templateItemId: string,
  input: InspectionTemplateItemInput
): Promise<InspectionTemplateItem> {
  const user = await requireTemplateManager();
  const parsed = inspectionTemplateItemSchema.parse(input);

  const supabase = await createClient();
  const { data: previous } = await supabase
    .from("inspection_template_item")
    .select(COLUMNS)
    .eq("template_item_id", templateItemId)
    .maybeSingle();

  if (!previous) throw new Error("TEMPLATE_ITEM_NOT_FOUND");

  const { data, error } = await supabase
    .from("inspection_template_item")
    .update({
      category: parsed.category,
      item_name: parsed.item_name,
      display_order: parsed.display_order,
      requires_measurement: parsed.requires_measurement,
      updated_at: new Date().toISOString(),
    })
    .eq("template_item_id", templateItemId)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const item = data as InspectionTemplateItem;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "inspection_template_item_updated",
    entity_type: "inspection_template_item",
    entity_id: templateItemId,
    description: `Inspection item ${item.category} / ${item.item_name} updated`,
    old_value: previous,
    new_value: item,
  });

  return item;
}

/** Template items are never hard deleted; historical inspections keep snapshots. */
export async function setInspectionTemplateItemActive(
  templateItemId: string,
  active: boolean
): Promise<InspectionTemplateItem> {
  const user = await requireTemplateManager();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("inspection_template_item")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("template_item_id", templateItemId)
    .select(COLUMNS)
    .single();

  if (error) throw error;
  const item = data as InspectionTemplateItem;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: active
      ? "inspection_template_item_reactivated"
      : "inspection_template_item_deactivated",
    entity_type: "inspection_template_item",
    entity_id: templateItemId,
    description: `Inspection item ${item.category} / ${item.item_name} ${
      active ? "reactivated" : "deactivated"
    }`,
    old_value: { active: !active },
    new_value: { active },
  });

  return item;
}

/** Swap display_order between two template items. */
export async function swapInspectionTemplateItemOrder(
  itemIdA: string,
  itemIdB: string
): Promise<void> {
  const user = await requireTemplateManager();
  const supabase = await createClient();

  const { data: items, error: loadError } = await supabase
    .from("inspection_template_item")
    .select(COLUMNS)
    .in("template_item_id", [itemIdA, itemIdB]);

  if (loadError) throw loadError;
  const a = (items ?? []).find((i) => i.template_item_id === itemIdA);
  const b = (items ?? []).find((i) => i.template_item_id === itemIdB);
  if (!a || !b) throw new Error("TEMPLATE_ITEM_NOT_FOUND");

  const now = new Date().toISOString();
  const { error: errA } = await supabase
    .from("inspection_template_item")
    .update({ display_order: b.display_order, updated_at: now })
    .eq("template_item_id", itemIdA);
  if (errA) throw errA;

  const { error: errB } = await supabase
    .from("inspection_template_item")
    .update({ display_order: a.display_order, updated_at: now })
    .eq("template_item_id", itemIdB);
  if (errB) throw errB;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "inspection_template_item_reordered",
    entity_type: "inspection_template_item",
    entity_id: itemIdA,
    description: `Inspection items reordered: ${a.item_name} ↔ ${b.item_name}`,
    old_value: {
      [itemIdA]: a.display_order,
      [itemIdB]: b.display_order,
    },
    new_value: {
      [itemIdA]: b.display_order,
      [itemIdB]: a.display_order,
    },
  });
}
