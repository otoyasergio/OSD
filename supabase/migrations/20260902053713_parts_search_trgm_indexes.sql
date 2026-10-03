-- Parts Canada search ran four %term% ILIKE comparisons over ~78k rows with
-- no usable index: the old to_tsvector GIN index served a full-text query
-- shape the app never uses (searchPartsCanadaCatalog uses ilike), and btree
-- indexes cannot serve leading-wildcard patterns. pg_trgm is already
-- installed (customer search uses it), so give each searched column a
-- trigram GIN index and drop the dead full-text index.

create index if not exists idx_parts_canada_catalog_part_number_trgm
  on public.parts_canada_catalog using gin (part_number public.gin_trgm_ops);
create index if not exists idx_parts_canada_catalog_mfr_part_number_trgm
  on public.parts_canada_catalog using gin (manufacturer_part_number public.gin_trgm_ops);
create index if not exists idx_parts_canada_catalog_brand_trgm
  on public.parts_canada_catalog using gin (brand public.gin_trgm_ops);
create index if not exists idx_parts_canada_catalog_description_en_trgm
  on public.parts_canada_catalog using gin (description_en public.gin_trgm_ops);

drop index if exists public.idx_parts_canada_catalog_description_en;
