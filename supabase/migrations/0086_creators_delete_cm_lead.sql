-- Hapus kreator dibuka untuk CM Lead (leader TikTok & Shopee), sejajar dengan
-- PERMISSIONS['creators.delete'] = management + cm_lead. Sebelumnya 0028 hanya
-- management. CPM / akuisisi / creator_support tetap TIDAK boleh DELETE.
-- Pengaman aplikasi tak berubah: kreator dengan data material ditolak, snapshot
-- penuh masuk audit_logs. RESTRICTIVE creators_od_no_delete tetap berlaku.

drop policy if exists creators_delete on creators;
create policy creators_delete on creators
  for delete to authenticated
  using (public.is_management() or public.current_member_role() = 'cm_lead');
