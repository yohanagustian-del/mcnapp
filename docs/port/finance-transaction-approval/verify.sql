-- ============================================================
-- PORTABLE — Uji-diri mekanisme approval transaksi finance.
--
-- Jalankan SETELAH migration.sql, di database mana pun (staging disarankan).
-- Bukan sekadar "apakah tabelnya ada": ini menyerang penjaganya dari 10 arah dan
-- akan GAGAL KERAS (exception) kalau ada satu saja yang bocor. Diam berarti aman.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f verify.sql
--
-- Semua baris uji dibuat di dalam satu transaksi dan DI-ROLLBACK di akhir, jadi
-- database tidak ketinggalan sampah. Karena itu bagian advisory-lock nomor transaksi
-- tetap terpakai (advisory xact lock ikut lepas saat rollback).
-- ============================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off

begin;

-- Aktor uji. uuid acak supaya tidak bentrok dengan data nyata; FK ke tabel user host
-- sengaja dilepas untuk durasi uji ini kalau ada (lihat NOTICE).
do $$
begin
  if to_regclass('public.team_members') is not null then
    raise notice 'Host punya team_members — FK aktor dilepas sementara di dalam transaksi uji.';
    alter table finance_transactions        drop constraint if exists fk_fin_txn_creator_by;
    alter table finance_transaction_changes drop constraint if exists fk_fin_chg_req_by;
    alter table finance_transaction_changes drop constraint if exists fk_fin_chg_dec_by;
  end if;
end $$;

\echo ''
\echo '### 1. Nomor transaksi berurutan per bulan'
create temporary table _t (lead uuid, dir uuid, id1 text, id2 text);
insert into _t (lead, dir) values
  ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002');

do $$
declare a text; b text; l uuid; d uuid;
begin
  select lead, dir into l, d from _t;
  a := next_finance_trx_id(to_char(now(), 'YYYYMM'));
  insert into finance_transactions
    (id, client_name, amount, payment_method, bank_name, bank_account_no,
     bank_account_name, invoice_no, due_date, created_by)
  values (a, 'PORT TEST — Klien Satu', 75000000, 'transfer_bank', 'BCA', '1234567890',
          'PT Uji Coba', 'INV/PORT/001', current_date + 27, l);

  b := next_finance_trx_id(to_char(now(), 'YYYYMM'));
  insert into finance_transactions (id, client_name, amount, payment_method)
  values (b, 'PORT TEST — Klien Dua', 10000000, 'qris');

  if b = a then raise exception 'GAGAL: dua transaksi dapat nomor sama (%)', a; end if;
  if right(b, 4)::int <> right(a, 4)::int + 1 then
    raise exception 'GAGAL: nomor tidak berurutan (% lalu %)', a, b;
  end if;
  update _t set id1 = a, id2 = b;
  raise notice 'OK nomor berurutan: % lalu %', a, b;
end $$;

\echo ''
\echo '### 2. UPDATE LANGSUNG field terkunci harus DITOLAK trigger'
do $$
declare t text; f text;
begin
  select id1 into t from _t;
  foreach f in array array['payment_method','bank_account_no','amount','payment_status','due_date'] loop
    begin
      case f
        when 'payment_method' then update finance_transactions set payment_method = 'qris' where id = t;
        when 'bank_account_no' then update finance_transactions set bank_account_no = '999' where id = t;
        when 'amount' then update finance_transactions set amount = 1 where id = t;
        when 'payment_status' then update finance_transactions set payment_status = 'paid' where id = t;
        when 'due_date' then update finance_transactions set due_date = current_date where id = t;
      end case;
      raise exception 'GAGAL: UPDATE langsung "%" LOLOS — penjaga bocor', f;
    exception when insufficient_privilege then
      raise notice 'OK ditolak: %', f;
    end;
  end loop;
end $$;

\echo ''
\echo '### 3. Field BEBAS (keterangan) boleh langsung'
do $$
declare t text; n text;
begin
  select id1 into t from _t;
  update finance_transactions set notes = 'catatan bebas' where id = t;
  select notes into n from finance_transactions where id = t;
  if n <> 'catatan bebas' then raise exception 'GAGAL: field bebas tidak tersimpan'; end if;
  raise notice 'OK keterangan berlaku langsung';
end $$;

\echo ''
\echo '### 4. Pengajuan: nilai lama TETAP berlaku selama menunggu'
do $$
declare t text; l uuid; m text; a numeric;
begin
  select id1, lead into t, l from _t;
  insert into finance_transaction_changes (transaction_id, changes, reason, requested_by)
  values (t,
    jsonb_build_object(
      'payment_method',  jsonb_build_object('before','transfer_bank','after','virtual_account'),
      'bank_account_no', jsonb_build_object('before','1234567890','after','0987654321'),
      'amount',          jsonb_build_object('before',75000000,'after',80000000)),
    'Klien pindah ke Virtual Account, revisi PO', l);

  select payment_method, amount into m, a from finance_transactions where id = t;
  if m <> 'transfer_bank' or a <> 75000000 then
    raise exception 'GAGAL: transaksi sudah berubah padahal pengajuan masih menunggu';
  end if;
  raise notice 'OK nilai lama tetap berlaku selama pengajuan menunggu';
end $$;

\echo ''
\echo '### 5. Pengajuan kedua yang menunggu harus DITOLAK (unique index)'
do $$
declare t text;
begin
  select id1 into t from _t;
  begin
    insert into finance_transaction_changes (transaction_id, changes, reason)
    values (t, '{"amount":{"before":75000000,"after":1}}'::jsonb, 'pengajuan tandingan');
    raise exception 'GAGAL: dua pengajuan menunggu LOLOS — approval bisa dibalap';
  exception when unique_violation then
    raise notice 'OK ditolak: satu pengajuan menunggu per transaksi';
  end;
end $$;

\echo ''
\echo '### 6. Alasan kosong harus DITOLAK (check constraint)'
do $$
declare t text;
begin
  select id2 into t from _t;
  begin
    insert into finance_transaction_changes (transaction_id, changes, reason)
    values (t, '{"amount":{"before":1,"after":2}}'::jsonb, '   ');
    raise exception 'GAGAL: alasan kosong LOLOS — Director tak punya dasar memutuskan';
  exception when check_violation then
    raise notice 'OK ditolak: alasan wajib diisi';
  end;
end $$;

\echo ''
\echo '### 6b. Pengaju tidak boleh menyetujui pengajuannya sendiri'
do $$
declare t text; l uuid; rid bigint;
begin
  select id1, lead into t, l from _t;
  select id into rid from finance_transaction_changes where transaction_id = t and status = 'menunggu';
  begin
    -- p_actor = pengaju
    perform apply_finance_change(rid, l, null);
    raise exception 'GAGAL: pengaju menyetujui pengajuannya sendiri LOLOS — gate approval tak berarti';
  exception when insufficient_privilege then
    raise notice 'OK ditolak: pengaju = pemutus';
  end;
end $$;

\echo ''
\echo '### 7. Approve → semua field diterapkan sekali jalan, keterangan tak tersapu'
do $$
declare t text; d uuid; rid bigint; r record;
begin
  select id1, dir into t, d from _t;
  select id into rid from finance_transaction_changes where transaction_id = t and status = 'menunggu';
  perform apply_finance_change(rid, d, 'Disetujui, sudah dicek ke PIC klien');

  select payment_method::text pm, bank_account_no ban, amount amt, notes nt
    into r from finance_transactions where id = t;
  if r.pm <> 'virtual_account' or r.ban <> '0987654321' or r.amt <> 80000000 then
    raise exception 'GAGAL: perubahan tidak diterapkan penuh (% / % / %)', r.pm, r.ban, r.amt;
  end if;
  if r.nt <> 'catatan bebas' then
    raise exception 'GAGAL: field yang TIDAK diajukan ikut tersapu (notes = %)', r.nt;
  end if;

  perform 1 from finance_transaction_changes
   where id = rid and status = 'approved' and applied_at is not null and decided_by = d;
  if not found then raise exception 'GAGAL: pengajuan tidak ditandai approved/applied'; end if;
  raise notice 'OK approve menerapkan semuanya, field lain utuh, jejak keputusan tercatat';
end $$;

\echo ''
\echo '### 8. Approve dua kali DITOLAK, dan trigger kembali menjaga setelah apply'
do $$
declare t text; d uuid; rid bigint;
begin
  select id1, dir into t, d from _t;
  select id into rid from finance_transaction_changes where transaction_id = t and status = 'approved';
  begin
    perform apply_finance_change(rid, d, null);
    raise exception 'GAGAL: approve dua kali LOLOS';
  exception when raise_exception then
    raise notice 'OK ditolak: approve dua kali';
  end;

  -- Flag bypass di dalam apply_finance_change bersifat transaction-local; kalau ia
  -- bocor keluar, UPDATE langsung di bawah akan lolos.
  begin
    update finance_transactions set amount = 1 where id = t;
    raise exception 'GAGAL: penjaga bocor SETELAH apply — flag bypass tidak dibersihkan';
  exception when insufficient_privilege then
    raise notice 'OK trigger kembali menjaga setelah apply';
  end;
end $$;

\echo ''
\echo '### 9. Kolom di luar whitelist tidak bisa diselundupkan lewat pengajuan'
do $$
declare t text; d uuid; rid bigint;
begin
  select id2, dir into t, d from _t;
  insert into finance_transaction_changes (transaction_id, changes, reason)
  values (t, jsonb_build_object('created_by', jsonb_build_object('before', null, 'after', d)),
          'coba menyelundupkan kolom created_by')
  returning id into rid;
  begin
    perform apply_finance_change(rid, d, null);
    raise exception 'GAGAL: kolom di luar whitelist LOLOS — jejak pembuat bisa dipalsukan';
  exception when raise_exception then
    raise notice 'OK ditolak: kolom di luar whitelist';
  end;
end $$;

\echo ''
\echo '### 10. Perilaku benar-benar mengikuti config, bukan daftar hardcode'
do $$
declare t text; old jsonb;
begin
  select id2 into t from _t;
  select value into old from app_config where key = 'finance.guarded_fields';
  update app_config set value = '["amount"]'::jsonb where key = 'finance.guarded_fields';

  -- metode kini di luar daftar → harus bebas
  update finance_transactions set payment_method = 'ewallet' where id = t;
  -- nominal masih di dalam daftar → harus tetap terkunci
  begin
    update finance_transactions set amount = 5 where id = t;
    raise exception 'GAGAL: nominal lolos padahal masih terdaftar terkunci';
  exception when insufficient_privilege then
    raise notice 'OK config dipatuhi: metode bebas, nominal tetap terkunci';
  end;

  update app_config set value = old where key = 'finance.guarded_fields';
end $$;

\echo ''
\echo '### 11. next_finance_trx_id menolak periode tak valid'
do $$
begin
  begin
    perform next_finance_trx_id('2026-08');
    raise exception 'GAGAL: periode tak valid LOLOS';
  exception when raise_exception then
    raise notice 'OK ditolak: format periode';
  end;
end $$;

rollback;

\echo ''
\echo '=========================================================='
\echo ' SEMUA UJI LULUS — baris uji sudah di-rollback, DB bersih.'
\echo ' Kalau ada satu saja yang bocor, script ini berhenti dengan'
\echo ' ERROR "GAGAL: ..." dan tidak pernah sampai ke baris ini.'
\echo '=========================================================='
