import { makeKey, requiredModelTokens } from "@/lib/auctions/match";

export type AuctionRefreshBike = {
  motorcycleId: string;
  year: number;
  make: string;
  model: string;
};

/**
 * One provider query covers every year of the same make and model.
 * Blank make or model cannot be searched and is left out of the groups.
 */
export function auctionRefreshGroupKey(bike: {
  make: string;
  model: string;
}): string | null {
  if (!bike.make.trim() || !bike.model.trim()) return null;
  const make = makeKey(bike.make);
  const tokens = requiredModelTokens(bike.model, bike.make);
  if (!make || tokens.length === 0) return null;
  return `${make}:${tokens.join(",")}`;
}

export function groupMotorcyclesForAuctionRefresh(bikes: AuctionRefreshBike[]): {
  groups: Array<{ bikes: AuctionRefreshBike[] }>;
  skipped: AuctionRefreshBike[];
} {
  const skipped: AuctionRefreshBike[] = [];
  const groups: Array<{ key: string; bikes: AuctionRefreshBike[] }> = [];
  const indexByKey = new Map<string, number>();

  for (const bike of bikes) {
    const key = auctionRefreshGroupKey(bike);
    if (!key) {
      skipped.push(bike);
      continue;
    }
    const existing = indexByKey.get(key);
    if (existing == null) {
      indexByKey.set(key, groups.length);
      groups.push({ key, bikes: [bike] });
    } else {
      groups[existing].bikes.push(bike);
    }
  }

  return { groups, skipped };
}
