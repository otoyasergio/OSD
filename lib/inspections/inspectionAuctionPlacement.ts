/**
 * The inspection report is a two-column grid. "Brakes & Tires" is one short
 * row, and the lights section beside it is tall, so the open space under that
 * brake row is the left-column cell. The auction block belongs in that cell.
 */
export function inspectionAuctionAnchorCategory(categories: string[]): string | null {
  if (categories.includes("Brakes & Tires")) return "Brakes & Tires";
  for (let index = categories.length - 1; index >= 0; index -= 1) {
    const category = categories[index];
    if (category.startsWith("Brakes")) return category;
  }
  return null;
}
