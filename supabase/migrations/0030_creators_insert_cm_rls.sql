-- CM boleh menambah kreator (tab Kreator: tombol "Tambah Kreator", import Username+CM,
-- upload master sheet lengkap).
--
-- Sebelum ini creators_insert (0002) hanya mengizinkan management + akuisisi +
-- campaign_external, sementara PERMISSIONS['creators.bulk_upload'] juga hanya berisi
-- management + akuisisi — akibatnya tombol "Tambah Kreator" tidak pernah muncul untuk
-- CM Lead / CPM, padahal CM-lah yang mendaftarkan kreator yang mereka pegang.
--
-- Server action (createCreatorManual / import / upload master) memakai service-role
-- sehingga bypass RLS, tapi RLS harus mencerminkan izin yang sama — CLAUDE.md: enforce
-- di server (RLS + middleware), bukan cuma UI. Sejajar dengan creators_update (0002)
-- yang sudah memberi cm_lead/cpm izin UPDATE: menambah baris tidak lebih berisiko
-- daripada mengubah seluruh kolomnya (CLAUDE.md #2 — menambah data ≠ merugikan).
--
-- DELETE tetap management saja (creators_delete, 0028) dan commission_share tetap
-- read-only lewat trigger protect_commission_share (CLAUDE.md #3).
-- RESTRICTIVE creators_od_no_* tetap berlaku (od_viewer read-only absolut, M11 §2A.3).

drop policy if exists creators_insert on creators;
create policy creators_insert on creators
  for insert to authenticated
  with check (
    public.is_management()
    or public.current_member_role() in (
      'cm_lead','cpm',
      'acquisition_lead','acquisition_spec',
      'campaign_external'
    )
  );
