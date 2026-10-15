-- ============================================================
-- 0090_product_category_lookup.sql
-- Upload September 2026-10-15: export TikTok custom report (MCN MEA, MEA Academy,
-- TAP) TIDAK membawa kolom Level 1 / Level 2 category. Tanpa kategori,
-- creator_subcat_segment_gmv kosong (0 baris) → Creator Product Match & M6 pool
-- kehilangan data minggu itu.
--
-- Fungsi lookup kategori per product_id dari data yang sudah ada di platform:
-- creator_top_products (data platform, terbaru dulu) lalu products_tap (katalog TAP).
-- Dipanggil ingest HANYA untuk baris yang kategorinya kosong (deterministik, 0 LLM).
-- security invoker: RLS tabel dasarnya tetap berlaku (deny is_creator_user()).
-- Tanpa DROP apa pun (apply_migration menggantung, HANDOFF 2026-10-13/15).
-- ============================================================

create or replace function product_category_lookup(p_product_ids text[])
returns table (product_id text, level1_category text, level2_category text)
language sql
stable
security invoker
set search_path = public
as $$
  with ids as (
    select distinct unnest(p_product_ids) as product_id
  ),
  cand as (
    select t.product_id, t.level1_category, t.level2_category, 1 as src, t.period_start as seen
      from creator_top_products t
      join ids on ids.product_id = t.product_id
     where coalesce(btrim(t.level2_category), '') <> ''
    union all
    select p.product_id, p.level1_category, p.level2_category, 2 as src, null::date as seen
      from products_tap p
      join ids on ids.product_id = p.product_id
     where coalesce(btrim(p.level2_category), '') <> ''
  )
  select distinct on (c.product_id) c.product_id, c.level1_category, c.level2_category
    from cand c
   order by c.product_id, c.src, c.seen desc nulls last;
$$;

comment on function product_category_lookup(text[]) is
  'Kategori L1/L2 per product_id dari creator_top_products (terbaru) lalu products_tap — mengisi baris ingest yang export-nya tanpa kolom kategori (0090).';
