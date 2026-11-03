"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { canViewClients } from "@/lib/permissions";
import { loadAuctionPriceGuide } from "@/lib/services/auctionPriceGuide";
import { getMotorcycleById } from "@/lib/services/motorcycles";

export async function refreshAuctionPriceGuideAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!canViewClients(user.role)) throw new Error("FORBIDDEN");

  const motorcycleId = String(formData.get("motorcycle_id") ?? "").trim();
  const motorcycle = await getMotorcycleById(motorcycleId);
  if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");

  await loadAuctionPriceGuide({
    motorcycleId,
    bike: {
      year: motorcycle.year,
      make: motorcycle.make,
      model: motorcycle.model,
    },
    audience: "staff",
    refresh: "force",
  });
  revalidatePath(`/motorcycles/${motorcycleId}`);
}
