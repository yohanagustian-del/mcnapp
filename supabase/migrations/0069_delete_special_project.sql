-- Hapus Special Project (M7) beserta seluruh data turunannya, atomik dalam satu
-- fungsi (bukan serangkaian DELETE terpisah dari app — kalau salah satu gagal di
-- tengah jalan, project akan setengah terhapus). Banyak FK ke special_projects(id)
-- masih NO ACTION (bukan CASCADE) supaya penghapusan tak sengaja di modul lain
-- tertahan; fungsi ini yang tahu urutan aman menghapusnya untuk project spesifik.
--
-- ads_briefs SENGAJA TIDAK dihapus (project_id di sana cuma penanda "campaign ini
-- bagian dari project X") — cukup project_id-nya dilepas ke null, brief & hasil
-- iklannya tetap ada karena datanya milik M10, bukan M7.
create or replace function delete_special_project(p_project_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from creator_report_credits
    where report_id in (select id from creator_reports where project_id = p_project_id);
  delete from creator_reports where project_id = p_project_id;

  -- project_live_sessions cascades ke project_live_intervals &
  -- project_live_session_products (migrasi 0056/0065) secara otomatis.
  delete from project_live_sessions where project_id = p_project_id;

  delete from project_creator_metrics where project_id = p_project_id;
  delete from project_creator_products where project_id = p_project_id;

  -- Batch upload cuma bisa dihapus setelah baris yang mereferensikannya
  -- (project_creator_metrics/products/live_sessions) di atas sudah hilang.
  delete from metric_upload_batches where project_id = p_project_id;

  delete from project_daily_metrics where project_id = p_project_id;
  delete from project_feedback where project_id = p_project_id;
  delete from project_announcements where project_id = p_project_id;
  delete from project_manpower where project_id = p_project_id;
  delete from project_participants where project_id = p_project_id;

  -- project_join_requests, project_external_applicants, project_creator_requirements
  -- sudah ON DELETE CASCADE (0011/0058) — ikut hilang lewat DELETE di bawah.
  update ads_briefs set project_id = null where project_id = p_project_id;

  delete from special_projects where id = p_project_id;
end;
$$;

comment on function delete_special_project(bigint) is
  'Hapus special_projects + seluruh data turunannya secara atomik (dipanggil dari server action deleteProject, m7.manage + role management). ads_briefs hanya dilepas project_id-nya, tidak ikut terhapus.';
