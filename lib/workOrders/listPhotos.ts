export function withPrimaryPhotoUrls<T extends { work_order_id: string }>(
  items: readonly T[],
  urls: ReadonlyMap<string, string | null>
): Array<T & { primary_photo_url: string | null }> {
  return items.map((item) => ({
    ...item,
    primary_photo_url: urls.get(item.work_order_id) ?? null,
  }));
}
