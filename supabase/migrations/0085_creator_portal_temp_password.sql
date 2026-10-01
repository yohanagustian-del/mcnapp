-- ============================================================
-- 0085_creator_portal_temp_password.sql
-- Portal Kreator: undangan pakai PASSWORD SEMENTARA unik per kreator + Reset
-- Password oleh CM (request user 2026-10-01, opsi A+B). Menggantikan usulan
-- password default bersama "@Mcnmea" — password yang sama untuk semua kreator
-- (dan "lupa password = kembali ke @Mcnmea") membuat siapa pun yang tahu email
-- seorang kreator bisa masuk ke akunnya.
--
-- Alur: staff klik Undang / Reset Password → server membuat password acak
-- (lib/portal/temp-password.ts), menyetelnya di Supabase Auth, dan menandai
-- must_change_password = true. Kreator login dengan password itu lalu dipaksa
-- membuat password sendiri di /ganti-password (requireCreator()). Password
-- sementara TIDAK PERNAH disimpan di tabel mana pun — hanya ditampilkan sekali
-- ke staff untuk dikirim lewat WA.
-- ============================================================

alter table creator_users
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temp_password_set_at timestamptz;

comment on column creator_users.must_change_password is
  'true = akun login dengan password sementara (undangan / Reset Password oleh staff); kreator wajib membuat password sendiri di /ganti-password sebelum bisa membuka portal.';
comment on column creator_users.temp_password_set_at is
  'Kapan password sementara terakhir dibuat oleh staff (null setelah kreator mengganti password). Password-nya sendiri tidak disimpan.';
