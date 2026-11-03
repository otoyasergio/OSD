import type {
  AuctionSourceConnection,
  ResearchedAuctionSource,
} from "@/lib/auctions/types";

/**
 * Auction tapes considered for the motorcycle price guide.
 *
 * ALT/FNDATA is the same motorcycle dataset sold on AWS Marketplace as
 * "Historical + Real-time Motorcycle Auction Sales by Lot" (AWS Data Exchange,
 * product prodview-74fycri27htea). The API and a file export of that feed share
 * one importer. Houses already inside that feed are not listed again as gaps.
 */
export const AUCTION_SOURCE_CATALOG = [
  {
    id: "altfndata",
    name: "ALT/FNDATA motorcycle auctions",
    covers:
      "Collector and specialty lots from 1999 onward, including Mecum, Bonhams, and RM Sotheby's. AWS Data Exchange delivers the file; api.altfndata.com queries the same tape. Realized prices are normalized to US dollars, then shown here in Canadian dollars.",
    connection: "connected",
  },
  {
    id: "bring_a_trailer",
    name: "Bring a Trailer",
    covers:
      "North American online auctions, including many motorcycles people still ride. There is no official results API. A licensed export can be imported later.",
    connection: "not_connected",
  },
  {
    id: "iconic",
    name: "Iconic Auctioneers",
    covers:
      "British and European motorcycle auctions, including the former Silverstone sales. No public API. A house export can be imported with the generic columns.",
    connection: "not_connected",
  },
  {
    id: "collecting_cars",
    name: "Collecting Cars",
    covers: "Online collector auctions that include motorcycles. No public results API.",
    connection: "not_connected",
  },
  {
    id: "hemmings",
    name: "Hemmings Auctions",
    covers: "Online collector auctions that include motorcycles. No public results API.",
    connection: "not_connected",
  },
  {
    id: "japan_wholesale",
    name: "Japanese wholesale auctions",
    covers:
      "BDS, JBA, ARAI, and AUCNET sold prices for modern used bikes, in yen. Commercial APIs exist. Those are export-wholesale results, a different market from a Canadian owner's price guide.",
    connection: "not_connected",
  },
] as const;

export const APPRAISAL_GUIDES_NOTE =
  "Canadian Black Book Powersports and Hagerty publish appraisals. They are outside this guide, which only lists motorcycles that sold at auction.";

const SOURCE_NAMES: Record<string, string> = {
  altfndata: "ALT/FNDATA",
  bring_a_trailer: "Bring a Trailer",
  iconic: "Iconic Auctioneers",
  collecting_cars: "Collecting Cars",
  hemmings: "Hemmings Auctions",
  japan_wholesale: "Japanese wholesale auctions",
  mecum: "Mecum",
  bonhams: "Bonhams",
  rm_sothebys: "RM Sotheby's",
  fixture: "Fixture",
  other: "Imported file",
};

export function auctionSourceName(sourceId: string): string {
  return SOURCE_NAMES[sourceId] ?? "Imported file";
}

export function researchedAuctionSources(
  altfnConfigured: boolean
): ResearchedAuctionSource[] {
  return AUCTION_SOURCE_CATALOG.map((source) => ({
    id: source.id,
    name: source.name,
    covers: source.covers,
    connection: source.connection as AuctionSourceConnection,
    connectionLabel: connectionLabel(source.id, source.connection, altfnConfigured),
  }));
}

function connectionLabel(
  id: string,
  connection: AuctionSourceConnection,
  altfnConfigured: boolean
): string {
  if (id === "altfndata") {
    return altfnConfigured
      ? "API key set. File import also accepted."
      : "API key not set. A JSON or CSV export can still be imported.";
  }
  if (connection === "not_connected") return "Not connected. File import only.";
  return "File import.";
}
