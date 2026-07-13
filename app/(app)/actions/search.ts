"use server";

import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions";
import { searchAll, type SearchResult } from "@/lib/services/globalSearch";

export async function searchShopRecords(query: string): Promise<SearchResult[]> {
  const user = await requireUser();
  if (!user.active_location_id) return [];

  return searchAll(query, {
    locationId: user.active_location_id,
    limit: 8,
    includeClients: canViewClients(user.role),
  });
}
