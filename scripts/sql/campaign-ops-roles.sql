-- ============================================================
-- Ubah role 3 akun ke campaign_ops (keputusan Yohan 2026-10-20, DECISIONS D-2026-10-20-6).
-- DISIAPKAN SAJA — JANGAN DIJALANKAN tanpa persetujuan eksplisit Yohan.
--
-- Hasil pencocokan nama ke team_members PRODUKSI (dibaca read-only 2026-10-20):
--   | Nama di brief | Ditemukan                                   | Role sekarang | Aktif | Tindakan |
--   |---------------|---------------------------------------------|---------------|-------|----------|
--   | Lala          | TIDAK ADA anggota bernama/mirip "Lala"      | —             | —     | perlu email/nama lengkap dari Yohan |
--   | Diena         | "Diena Shofwah" (diena.shofwah07@gmail.com) | campaign_ops  | ya    | SUDAH campaign_ops → tidak perlu diubah |
--   | ZamZam        | "zamzam" (zamzamfirdaus90@gmail.com)        | cpm (bukan bizdev) | TIDAK | perlu konfirmasi: aktifkan + ubah role? |
--
-- Karena itu UPDATE di bawah memakai email yang harus dikonfirmasi dulu. Jalankan blok
-- pemeriksaan (SELECT) dulu; bila hasilnya persis yang dimaksud, jalankan transaksi.
-- ============================================================

-- 1. Pemeriksaan (read-only)
select id, name, email, role, team_group, active
from team_members
where lower(name) like any (array['%lala%', '%diena%', '%zamzam%', '%zam zam%'])
order by name;

-- 2. Perubahan (isi email Lala setelah dikonfirmasi; hapus baris yang tidak disetujui)
begin;

update team_members
set role = 'campaign_ops', team_group = 'bizdev'
where email in (
  '<email-lala-dikonfirmasi-yohan>',
  'zamzamfirdaus90@gmail.com'          -- saat ini cpm & nonaktif: konfirmasi dulu
)
and role <> 'campaign_ops'
returning id, name, email, role, active;

-- Diena Shofwah sudah campaign_ops: tidak ada perubahan.

insert into audit_logs (actor_id, action, entity_type, entity_id, before, after, type)
select null, 'team.role_change_campaign_ops', 'team_members', id::text,
       null, jsonb_build_object('role', 'campaign_ops', 'source', 'DECISIONS D-2026-10-20-6'), 'approval'
from team_members
where email in ('<email-lala-dikonfirmasi-yohan>', 'zamzamfirdaus90@gmail.com');

-- commit;   -- aktifkan setelah hasil RETURNING diperiksa
rollback;
