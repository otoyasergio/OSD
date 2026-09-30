"use server";

import { requireUser } from "@/lib/auth/session";
import { getRolePreviewContext } from "@/lib/auth/role-preview";
import { canViewClients } from "@/lib/permissions";
import { searchAll, type SearchResult } from "@/lib/services/globalSearch";

export async function searchShopRecords(query: string): Promise<SearchResult[]> {
  const user = await requireUser();
  if (!user.active_location_id) return [];

  // Read-only action: customer visibility follows the owner's preview role.
  const preview = await getRolePreviewContext();

  return searchAll(query, {
    locationId: user.active_location_id,
    limit: 8,
    includeClients: canViewClients(preview?.role ?? user.role),
  });
}
