-- ============================================================================
-- MERGE DUPLIKAT MASTER KREATOR (operasional, sekali jalan per database)
--
-- Konteks: produksi 2026-07-30 punya 3.269 baris `creators` untuk 1.140 username unik
-- (satu username sampai 18 baris). Penyebab: lookup kreator existing menarik seluruh
-- tabel dengan `.limit(5000)` sementara PostgREST memotong di 1.000 baris → setiap
-- kreator di luar 1.000 baris pertama dianggap belum ada dan dibuat lagi tiap upload.
-- Perbaikan kode: src/lib/creators/registry.ts (lookup berpaginasi) + gerbang master
-- kreator (migration 0028). Script ini membereskan data yang sudah kotor.
--
-- Aturan merge (keputusan user 2026-07-30):
--   • Kunci identitas  : (lower(username), coalesce(platform,'tiktok'))
--   • Pemenang         : baris created_at PALING AWAL (id lama tetap valid)
--   • Field kosong     : diisi dari duplikat yang punya nilainya (yang terbaru menang)
--   • Data turunan     : dipindahkan ke pemenang, lalu di-dedup per (kreator, minggu)
--   • Jejak            : creators_merge_map (id lama → id baru) + audit_logs
--
-- CARA PAKAI
--   1. Jalankan BAGIAN A (dry run) → periksa angkanya.
--   2. Backup / pastikan PITR aktif.
--   3. Jalankan BAGIAN B (satu transaksi; gagal = tidak ada yang berubah).
--   4. Jalankan BAGIAN C (verifikasi) → harus 0 duplikat.
--   5. Apply migration 0029 (unique index) supaya duplikat tak mungkin terulang.
--
-- PRASYARAT: migration 0028 sudah di-apply (butuh tabel creators_merge_map).
-- ============================================================================


-- ============================================================================
-- BAGIAN A — DRY RUN (hanya SELECT, tidak mengubah apa pun)
-- ============================================================================

-- A.1 Ringkasan dampak
with grp as (
  select lower(username) as ukey, coalesce(platform, 'tiktok') as pkey,
         count(*) as n,
         (array_agg(id order by created_at asc, id asc))[1] as winner_id
  from creators
  where username is not null
  group by 1, 2
), dup as (
  select * from grp where n > 1
), map as (
  select c.id as loser_id, d.winner_id
  from creators c
  join dup d on lower(c.username) = d.ukey and coalesce(c.platform, 'tiktok') = d.pkey
  where c.id <> d.winner_id
)
select 'baris creators sekarang'            as metrik, count(*)::text as nilai from creators
union all select 'username unik (identitas)', (select count(*)::text from grp)
union all select 'grup duplikat',             (select count(*)::text from dup)
union all select 'baris yang akan dihapus',   (select count(*)::text from map)
union all select 'baris creators setelah merge',
                 (select (count(*) - (select count(*) from map))::text from creators)
union all select 'grup dgn >1 CM berbeda (perlu dilihat manual)',
  (select count(*)::text from (
     select d.ukey from creators c
     join dup d on lower(c.username) = d.ukey and coalesce(c.platform, 'tiktok') = d.pkey
     where c.owner_cpm_id is not null
     group by d.ukey having count(distinct c.owner_cpm_id) > 1) x)
union all select 'baris creator_period_summary yang akan di-dedup (perkiraan)',
  (select coalesce(sum(n - 1), 0)::text from (
     select count(*) as n from creator_period_summary cps
     where cps.creator_id in (select loser_id from map) or cps.creator_id in (select winner_id from dup)
     group by cps.creator_id, cps.period_start) y);

-- A.2 Grup dengan CM berbeda — cek manual sebelum apply (pemenang mewarisi CM
--     dari duplikat TERBARU yang punya CM kalau pemenang sendiri kosong).
select lower(c.username) as username,
       count(*) as baris,
       string_agg(distinct coalesce(tm.name, '(tanpa CM)'), ' | ') as cm_terdeteksi
from creators c
left join team_members tm on tm.id = c.owner_cpm_id
where c.username is not null
  and (lower(c.username), coalesce(c.platform, 'tiktok')) in (
    select lower(username), coalesce(platform, 'tiktok') from creators
    where username is not null
    group by 1, 2 having count(*) > 1)
group by 1
having count(distinct c.owner_cpm_id) > 1
order by baris desc;

-- A.3 10 duplikat terbanyak (untuk sanity check)
select lower(username) as username, coalesce(platform, 'tiktok') as platform, count(*) as baris,
       min(created_at) as pertama, max(created_at) as terakhir
from creators
where username is not null
group by 1, 2
having count(*) > 1
order by baris desc, username
limit 10;


-- ============================================================================
-- BAGIAN B — APPLY (satu transaksi; jalankan sebagai SATU batch)
-- ============================================================================
begin;

-- B.1 Peta pemenang → pecundang -------------------------------------------------
create temp table _dedupe_group on commit drop as
select lower(username) as ukey,
       coalesce(platform, 'tiktok') as pkey,
       (array_agg(id order by created_at asc, id asc))[1] as winner_id,
       count(*) as n
from creators
where username is not null
group by 1, 2
having count(*) > 1;

create temp table _dedupe_map on commit drop as
select c.id as loser_id, g.winner_id, g.ukey as username, g.pkey as platform
from creators c
join _dedupe_group g on lower(c.username) = g.ukey and coalesce(c.platform, 'tiktok') = g.pkey
where c.id <> g.winner_id;

create index on _dedupe_map (loser_id);
create index on _dedupe_map (winner_id);

insert into creators_merge_map (loser_id, winner_id, username, platform)
select loser_id, winner_id, username, nullif(platform, 'tiktok')
from _dedupe_map
on conflict (loser_id) do nothing;

-- B.2 Lengkapi field kosong pemenang dari duplikatnya ---------------------------
-- Untuk SETIAP kolom creators (kecuali kunci & metadata), pemenang yang NULL diisi
-- nilai non-NULL dari duplikat TERBARU. Dinamis supaya kolom baru di masa depan
-- otomatis ikut dan tidak ada daftar 40 kolom yang bisa basi.
--
-- DISTINCT ON (bukan array_agg[1]) supaya AMAN untuk kolom bertipe array seperti
-- top_niches (text[]) — array_agg atas kolom array menghasilkan array 2-D yang
-- subscript-nya tak lagi cocok dengan tipe kolom.
do $$
declare col record;
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'creators'
      and column_name not in ('id', 'created_at', 'username', 'platform')
      and is_generated = 'NEVER'
  loop
    execute format($f$
      update creators w
         set %1$I = s.val
        from (
          select distinct on (m.winner_id) m.winner_id, l.%1$I as val
            from _dedupe_map m
            join creators l on l.id = m.loser_id
           where l.%1$I is not null
           order by m.winner_id, l.created_at desc nulls last, l.id desc
        ) s
       where w.id = s.winner_id and w.%1$I is null
    $f$, col.column_name);
  end loop;
end $$;

-- platform: pemenang tanpa platform mewarisi platform duplikatnya (grup NULL+tiktok).
update creators w
   set platform = s.val
  from (
    select distinct on (m.winner_id) m.winner_id, l.platform as val
      from _dedupe_map m
      join creators l on l.id = m.loser_id
     where l.platform is not null
     order by m.winner_id, l.created_at desc nulls last, l.id desc
  ) s
 where w.id = s.winner_id and w.platform is null;

-- B.3 Bersihkan tabrakan kunci sebelum memindahkan data turunan -----------------
-- Tabel berkunci-alami yang memuat creator_id: setelah SEMUA loser di-repoint ke
-- pemenang, satu (pemenang, kunci-alami) bisa muncul >1× — baik dari loser-vs-
-- pemenang MAUPUN loser-vs-loser (dua baris duplikat berbagi minggu yang sama).
-- Karena itu dikelompokkan per (target pemenang, kunci-alami) dan disisakan SATU
-- baris: baris milik pemenang didahulukan, lalu yang terbaru. Pakai ctid (aman di
-- dalam transaksi) supaya tak butuh kolom id surrogate.

-- creator_link_status: pk (creator_id, week)
delete from creator_link_status t using (
  select ctid from (
    select cls.ctid,
           row_number() over (
             partition by coalesce(m.winner_id, cls.creator_id), cls.week
             order by (cls.creator_id = coalesce(m.winner_id, cls.creator_id)) desc, cls.ctid
           ) rn
      from creator_link_status cls
      left join _dedupe_map m on m.loser_id = cls.creator_id
     where cls.creator_id in (select loser_id from _dedupe_map)
        or cls.creator_id in (select winner_id from _dedupe_map)
  ) x where rn > 1
) d where t.ctid = d.ctid;

-- metrics_monthly_agg: pk (creator_id, month, metric, source)
delete from metrics_monthly_agg t using (
  select ctid from (
    select mma.ctid,
           row_number() over (
             partition by coalesce(m.winner_id, mma.creator_id), mma.month, mma.metric, mma.source
             order by (mma.creator_id = coalesce(m.winner_id, mma.creator_id)) desc, mma.ctid
           ) rn
      from metrics_monthly_agg mma
      left join _dedupe_map m on m.loser_id = mma.creator_id
     where mma.creator_id in (select loser_id from _dedupe_map)
        or mma.creator_id in (select winner_id from _dedupe_map)
  ) x where rn > 1
) d where t.ctid = d.ctid;

-- creator_period_summary: unique (creator_id, period_start, upload_batch) — B.5 masih
-- men-dedup lagi per (creator_id, period_start), ini hanya cegah tabrakan unique saat repoint.
delete from creator_period_summary t using (
  select ctid from (
    select cps.ctid,
           row_number() over (
             partition by coalesce(m.winner_id, cps.creator_id), cps.period_start, cps.upload_batch
             order by (cps.creator_id = coalesce(m.winner_id, cps.creator_id)) desc,
                      cps.created_at desc nulls last, cps.ctid
           ) rn
      from creator_period_summary cps
      left join _dedupe_map m on m.loser_id = cps.creator_id
     where cps.creator_id in (select loser_id from _dedupe_map)
        or cps.creator_id in (select winner_id from _dedupe_map)
  ) x where rn > 1
) d where t.ctid = d.ctid;

-- Akun portal kreator (M9): unique (creator_id) + unique (email/auth_uid/invite_token).
-- Sisakan satu per pemenang (baris pemenang sendiri didahulukan).
delete from creator_users t using (
  select ctid from (
    select cu.ctid,
           row_number() over (
             partition by coalesce(m.winner_id, cu.creator_id)
             order by (cu.creator_id = coalesce(m.winner_id, cu.creator_id)) desc, cu.ctid
           ) rn
      from creator_users cu
      left join _dedupe_map m on m.loser_id = cu.creator_id
     where cu.creator_id in (select loser_id from _dedupe_map)
        or cu.creator_id in (select winner_id from _dedupe_map)
  ) x where rn > 1
) d where t.ctid = d.ctid;

-- B.4 Pindahkan SEMUA data turunan ke pemenang ---------------------------------
-- Dinamis atas seluruh FK yang menunjuk creators — tidak ada tabel yang terlewat
-- kalau nanti ada tabel baru.
do $$
declare fk record;
begin
  for fk in
    select distinct c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
     where c.contype = 'f'
       and c.confrelid = 'creators'::regclass
       and c.conrelid <> 'creators_merge_map'::regclass
  loop
    execute format(
      'update %s t set %I = m.winner_id from _dedupe_map m where t.%I = m.loser_id',
      fk.tbl, fk.col, fk.col);
  end loop;
end $$;

-- B.5 Dedup agregat mingguan pemenang -----------------------------------------
-- Setelah pemindahan, satu (kreator, minggu) bisa punya beberapa baris dari batch
-- upload berbeda → GMV terhitung berkali-kali oleh konsumen yang menjumlah
-- (matching M5, report M2, GMV akuisisi). Simpan baris dari batch TERBARU saja.
delete from creator_period_summary cps
 using (
   select id from (
     select id, row_number() over (
              partition by creator_id, period_start
              order by created_at desc nulls last, id desc) as rn
       from creator_period_summary
      where creator_id in (select winner_id from _dedupe_map)
   ) x where rn > 1
 ) d
 where cps.id = d.id;

delete from creator_top_products ctp
 using (
   select t.id
     from creator_top_products t
     join (
       select creator_id, period_start,
              (array_agg(upload_batch order by created_at desc nulls last, id desc))[1] as keep_batch
         from creator_top_products
        where creator_id in (select winner_id from _dedupe_map)
        group by 1, 2
     ) w on w.creator_id = t.creator_id and w.period_start = t.period_start
    where t.creator_id in (select winner_id from _dedupe_map)
      and t.upload_batch <> w.keep_batch
 ) d
 where ctp.id = d.id;

delete from creator_subcat_segment_gmv cssg
 using (
   select t.id
     from creator_subcat_segment_gmv t
     join (
       select creator_id, window_end,
              (array_agg(upload_batch order by created_at desc nulls last, id desc))[1] as keep_batch
         from creator_subcat_segment_gmv
        where creator_id in (select winner_id from _dedupe_map)
        group by 1, 2
     ) w on w.creator_id = t.creator_id and w.window_end = t.window_end
    where t.creator_id in (select winner_id from _dedupe_map)
      and t.upload_batch <> w.keep_batch
 ) d
 where cssg.id = d.id;

-- B.6 Hapus baris duplikat + catat audit --------------------------------------
insert into audit_logs (actor_id, action, entity_type, entity_id, before, after, type)
select null, 'creator.dedupe_merge', 'creators', m.winner_id,
       jsonb_build_object('merged_ids', array_agg(m.loser_id order by m.loser_id)),
       jsonb_build_object('username', min(m.username), 'kept_id', m.winner_id,
                          'merged_count', count(*)),
       'auto'
  from _dedupe_map m
 group by m.winner_id;

delete from creators c using _dedupe_map m where c.id = m.loser_id;

commit;


-- ============================================================================
-- BAGIAN C — VERIFIKASI (jalankan setelah BAGIAN B; semua harus sesuai harapan)
-- ============================================================================
select 'duplikat sisa (harus 0)' as metrik,
       (select count(*)::text from (
          select 1 from creators where username is not null
           group by lower(username), coalesce(platform, 'tiktok') having count(*) > 1) d) as nilai
union all select 'baris creators', (select count(*)::text from creators)
union all select 'username unik',
  (select count(distinct (lower(username), coalesce(platform, 'tiktok')))::text
     from creators where username is not null)
union all select 'baris di creators_merge_map', (select count(*)::text from creators_merge_map)
union all select 'creator_period_summary ganda per (kreator,minggu) (harus 0)',
  (select count(*)::text from (
     select 1 from creator_period_summary
      group by creator_id, period_start having count(*) > 1) d)
union all select 'baris turunan yang masih menunjuk id terhapus (harus 0)',
  (select count(*)::text from creator_period_summary cps
    where not exists (select 1 from creators c where c.id = cps.creator_id));
