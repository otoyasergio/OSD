import { fetchAltfnMotorcycleLots } from "@/lib/auctions/altfndata";
import { makeProbe, modelProbe } from "@/lib/auctions/match";
import {
  groupMotorcyclesForAuctionRefresh,
  type AuctionRefreshBike,
} from "@/lib/auctions/refreshGroups";
import type { AuctionLotRecord } from "@/lib/auctions/types";
import { createAuctionAdminClient } from "@/lib/database/supabase-admin";
import {
  loadAuctionPriceGuide,
  upsertAuctionLots,
} from "@/lib/services/auctionPriceGuide";

/** Stop the daily run before the 300s Vercel limit. */
export const AUCTION_REFRESH_BUDGET_MS = 240_000;

const MOTORCYCLE_PAGE_SIZE = 1000;

export type { AuctionRefreshBike };

/**
 * A shop visit used only to decide that finished work still gets a price.
 * `status` is `work_order.status`. `completed` plus `completed_at` is a
 * filed work order. `inspectionCompletedAt` is `inspection.completed_at`,
 * which is set when the report is finished and can be earlier than the
 * work order status.
 */
export type AuctionRefreshWork = {
  motorcycleId: string;
  status: string;
  completedAt: string | null;
  inspectionCompletedAt?: string | null;
};

export type AuctionRefreshResult = {
  ok: true;
  motorcycles: number;
  groups: number;
  providerFetches: number;
  providerFailures: number;
  lotsUpserted: number;
  snapshotsRebuilt: number;
  skipped: number;
  failed: number;
  remaining: number;
  truncated: boolean;
};

type ProviderFetch<TLot> = {
  configured: boolean;
  lots: TLot[];
  message: string | null;
  failed: boolean;
};

export type AuctionRefreshRun<TLot> = {
  hasKey: boolean;
  bikes: AuctionRefreshBike[];
  fetchLots: (bike: AuctionRefreshBike) => Promise<ProviderFetch<TLot>>;
  upsertLots: (lots: TLot[]) => Promise<number>;
  rebuildLocal: (bike: AuctionRefreshBike) => Promise<{ ok: boolean }>;
  startedAt: number;
  deadlineMs: number;
  now: () => number;
};

/**
 * Pages of the motorcycle table. There is no work-order status filter:
 * a bike whose only job is already completed is still listed.
 */
export function auctionMotorcycleListQuery(page: number): {
  table: "motorcycle";
  select: "motorcycle_id, year, make, model";
  order: "motorcycle_id";
  from: number;
  to: number;
} {
  const from = page * MOTORCYCLE_PAGE_SIZE;
  return {
    table: "motorcycle",
    select: "motorcycle_id, year, make, model",
    order: "motorcycle_id",
    from,
    to: from + MOTORCYCLE_PAGE_SIZE - 1,
  };
}

function isFinishedShopWork(order: AuctionRefreshWork): boolean {
  return (
    order.status === "completed" ||
    Boolean(order.completedAt) ||
    Boolean(order.inspectionCompletedAt)
  );
}

/**
 * Auction snapshots follow the motorcycle, not the open job.
 * Finished work stays in the list, and so does work still on the floor.
 * A blank make or model is skipped later, when the bikes are grouped.
 */
export function motorcyclesForAuctionRefresh(input: {
  motorcycles: AuctionRefreshBike[];
  workOrders: AuctionRefreshWork[];
}): AuctionRefreshBike[] {
  const byId = new Map<string, AuctionRefreshBike>();
  for (const bike of input.motorcycles) {
    if (!byId.has(bike.motorcycleId)) byId.set(bike.motorcycleId, bike);
  }

  const selected: AuctionRefreshBike[] = [];
  const seen = new Set<string>();
  const push = (bike: AuctionRefreshBike | undefined) => {
    if (!bike || seen.has(bike.motorcycleId)) return;
    seen.add(bike.motorcycleId);
    selected.push(bike);
  };

  for (const bike of input.motorcycles) push(bike);

  for (const order of input.workOrders) {
    if (!isFinishedShopWork(order)) continue;
    push(byId.get(order.motorcycleId));
  }

  return selected;
}

function isAuctionTablesMissing(error: unknown): boolean {
  return error instanceof Error && error.message === "AUCTION_TABLES_MISSING";
}

export async function runAuctionPriceRefresh<TLot>(
  args: AuctionRefreshRun<TLot>
): Promise<AuctionRefreshResult> {
  const grouped = groupMotorcyclesForAuctionRefresh(args.bikes);
  let providerFetches = 0;
  let providerFailures = 0;
  let lotsUpserted = 0;
  let snapshotsRebuilt = 0;
  let failed = 0;
  let truncated = false;

  const pastDeadline = () => args.now() - args.startedAt >= args.deadlineMs;

  for (const group of grouped.groups) {
    let fetchedThisGroup = false;
    for (const bike of group.bikes) {
      if (pastDeadline()) {
        truncated = true;
        break;
      }

      if (args.hasKey && !fetchedThisGroup) {
        fetchedThisGroup = true;
        let fetched: ProviderFetch<TLot> | null = null;
        try {
          fetched = await args.fetchLots(group.bikes[0]);
          providerFetches += 1;
          if (fetched.failed) providerFailures += 1;
        } catch (error) {
          if (isAuctionTablesMissing(error)) throw error;
          providerFailures += 1;
        }
        if (fetched && fetched.lots.length > 0) {
          lotsUpserted += await args.upsertLots(fetched.lots);
        }
      }

      try {
        const saved = await args.rebuildLocal(bike);
        if (saved.ok) snapshotsRebuilt += 1;
        else failed += 1;
      } catch (error) {
        if (isAuctionTablesMissing(error)) throw error;
        failed += 1;
      }
    }
    if (truncated) break;
  }

  const skipped = grouped.skipped.length;
  const remaining = Math.max(0, args.bikes.length - skipped - snapshotsRebuilt - failed);

  return {
    ok: true,
    motorcycles: args.bikes.length,
    groups: grouped.groups.length,
    providerFetches,
    providerFailures,
    lotsUpserted,
    snapshotsRebuilt,
    skipped,
    failed,
    remaining,
    truncated,
  };
}

type MotorcycleRow = {
  motorcycle_id: string;
  year: number;
  make: string;
  model: string;
};

async function listAuctionMotorcycles(): Promise<AuctionRefreshBike[]> {
  const admin = createAuctionAdminClient();
  const bikes: AuctionRefreshBike[] = [];

  for (let page = 0; ; page += 1) {
    const query = auctionMotorcycleListQuery(page);
    const { data, error } = await admin
      .from("motorcycle")
      .select(query.select)
      .order(query.order)
      .range(query.from, query.to);
    if (error) throw error;
    const rows = (data ?? []) as MotorcycleRow[];
    for (const row of rows) {
      bikes.push({
        motorcycleId: row.motorcycle_id,
        year: row.year,
        make: row.make,
        model: row.model,
      });
    }
    if (rows.length < MOTORCYCLE_PAGE_SIZE) break;
  }

  return bikes;
}

/**
 * Rebuild every motorcycle's auction snapshot, including a bike whose
 * latest work order is `completed` or whose inspection already has
 * `completed_at`. The motorcycle table is the list, so finished work
 * is not filtered out.
 * With an ALT/FNDATA key, each make and model is fetched once.
 * Without a key, stored lots are still repriced in Canadian dollars.
 */
export async function refreshAuctionGuidesDaily(args?: {
  env?: Record<string, string | undefined>;
  now?: () => number;
  startedAt?: number;
}): Promise<AuctionRefreshResult> {
  const env = args?.env ?? process.env;
  const clock = args?.now ?? Date.now;
  const listed = await listAuctionMotorcycles();
  const bikes = motorcyclesForAuctionRefresh({
    motorcycles: listed,
    workOrders: [],
  });

  return runAuctionPriceRefresh({
    hasKey: Boolean(env.ALTFNDATA_API_KEY?.trim()),
    bikes,
    startedAt: args?.startedAt ?? clock(),
    deadlineMs: AUCTION_REFRESH_BUDGET_MS,
    now: clock,
    fetchLots: (bike) =>
      fetchAltfnMotorcycleLots({
        make: bike.make,
        model: bike.model,
        apiKey: env.ALTFNDATA_API_KEY?.trim() || undefined,
        baseUrl: env.ALTFNDATA_API_BASE_URL?.trim() || undefined,
        makeProbe: makeProbe(bike.make),
        modelProbe: modelProbe(bike.model, bike.make),
      }),
    upsertLots: (lots: AuctionLotRecord[]) => upsertAuctionLots(lots),
    rebuildLocal: async (bike) => {
      const loaded = await loadAuctionPriceGuide({
        motorcycleId: bike.motorcycleId,
        bike: { year: bike.year, make: bike.make, model: bike.model },
        audience: "staff",
        refresh: "local",
        env,
        now: clock(),
      });
      if (loaded.view.state === "unavailable") {
        throw new Error("AUCTION_TABLES_MISSING");
      }
      if (loaded.view.state === "error") return { ok: false };
      return { ok: true };
    },
  });
}
