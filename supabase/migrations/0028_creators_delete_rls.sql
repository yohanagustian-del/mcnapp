-- Hapus master data kreator (tab Kreator: tombol Hapus + bulk delete tercentang).
--
-- Sebelum ini tabel creators tidak punya PERMISSIVE policy untuk DELETE sama sekali
-- (hanya RESTRICTIVE creators_od_no_delete yang menolak od_viewer), sehingga DELETE
-- lewat klien authenticated selalu gagal. Server action deleteCreators() memakai
-- service-role (bypass RLS) dan sudah dijaga requirePermission('creators.delete'),
-- tapi RLS harus mencerminkan izin yang sama — CLAUDE.md: enforce di server
-- (RLS + middleware), bukan cuma UI.
--
-- Management saja (director/head/spv), sejajar dengan PERMISSIONS['creators.delete'].
-- CM / akuisisi / creator_support boleh UPDATE (creators_update) tapi TIDAK DELETE:
-- menghapus kreator berpotensi merugikan perusahaan (CLAUDE.md #2), dan kreator yang
-- sudah punya kontrak/report/komisi ditolak di layer aplikasi dengan saran memakai
-- status 'nonaktif'.
--
-- RESTRICTIVE creators_od_no_delete tetap berlaku (od_viewer read-only absolut, M11 §2A.3).

drop policy if exists creators_delete on creators;
create policy creators_delete on creators
  for delete to authenticated
  using (is_management());
