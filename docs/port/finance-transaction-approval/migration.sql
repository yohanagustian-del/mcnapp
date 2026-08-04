-- ============================================================
-- PORTABLE — Mekanisme ubah transaksi finance dengan approval Director
--
-- Ini versi LEPAS dari migration mcnapp 0031+0032, dibuat supaya bisa dipasang di
-- app lain (mis. MEAgrup/AgencyAPP yang memuat /finance/transactions) tanpa
-- menyeret schema MCN MEA. Bedanya dengan versi mcnapp:
--   * enum sendiri (finance_payment_terms_t / finance_payment_status_t) supaya tidak
--     bentrok dengan enum host yang mungkin sudah ada dengan arti berbeda
--   * kolom relasi (deal/creator/project) tanpa FK keras; FK ditambahkan OTOMATIS
--     hanya bila tabel tujuan memang ada di host
--   * tidak mengasumsikan helper RLS host (is_management(), current_member_role(),
--     dsb). Bagian RLS ditandai "ADAPTASI" — lihat §8
--   * tidak menulis audit_logs dari DB. Audit tetap tanggung jawab server action
--     host, supaya tidak menebak-nebak bentuk tabel audit host
--
-- Idempotent: aman dijalankan ulang.
--
-- URUTAN INTI (jangan diubah): tabel → trigger penjaga → RPC penerap.
-- Penjaganya adalah TRIGGER, bukan server action — kalau app host memakai
-- service-role/superuser untuk mutasi (seperti Supabase service-role yang bypass
-- RLS), trigger adalah satu-satunya lapisan yang tak bisa dilewati.
-- ============================================================

-- ---------- 1. Prasyarat lunak ----------
-- Tabel config. Kalau host sudah punya tabel config dengan nama lain, LEWATI blok ini
-- dan ganti setiap `app_config` di bawah dengan nama tabel host (lihat README §4).
create table if not exists app_config (
  key   text primary key,
  value jsonb not null
);

-- ---------- 2. Enum ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'finance_payment_method_t') then
    create type finance_payment_method_t as enum (
      'transfer_bank','virtual_account','ewallet','qris','kartu_kredit','tunai','potong_komisi'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'finance_payment_terms_t') then
    create type finance_payment_terms_t as enum ('lunas','invoice');
  end if;
  if not exists (select 1 from pg_type where typname = 'finance_payment_status_t') then
    create type finance_payment_status_t as enum ('pending','partial','paid');
  end if;
  if not exists (select 1 from pg_type where typname = 'finance_txn_direction_t') then
    create type finance_txn_direction_t as enum ('masuk','keluar');
  end if;
  if not exists (select 1 from pg_type where typname = 'finance_change_status_t') then
    create type finance_change_status_t as enum ('menunggu','approved','ditolak','dibatalkan');
  end if;
end $$;

-- ---------- 3. Transaksi ----------
-- id text format TRX-YYYYMM-NNNN: nomor dipakai manusia di invoice & rekonsiliasi
-- bank, jadi harus berurutan dan menunjukkan periode (bukan id acak/uuid).
create table if not exists finance_transactions (
  id                  text primary key,
  direction           finance_txn_direction_t  not null default 'masuk',
  client_name         text not null,
  deal_id             text,     -- FK opsional, lihat §7
  creator_id          text,     -- FK opsional, lihat §7
  project_id          bigint,   -- FK opsional, lihat §7
  invoice_no          text,
  amount              numeric not null check (amount >= 0),
  payment_method      finance_payment_method_t not null,
  payment_terms       finance_payment_terms_t  not null default 'invoice',
  payment_status      finance_payment_status_t not null default 'pending',
  bank_name           text,
  bank_account_no     text,
  bank_account_name   text,
  due_date            date,
  paid_at             date,
  notes               text,
  created_by          uuid,     -- FK opsional ke tabel user host, lihat §7
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_fin_txn_status  on finance_transactions(payment_status);
create index if not exists idx_fin_txn_created on finance_transactions(created_at desc);
create index if not exists idx_fin_txn_deal    on finance_transactions(deal_id);
create index if not exists idx_fin_txn_creator on finance_transactions(creator_id);

comment on table finance_transactions is
  'Transaksi finance. Field terkunci (app_config finance.guarded_fields) hanya bisa berubah lewat finance_transaction_changes + approval Director.';

-- ---------- 4. Pengajuan perubahan ----------
-- changes = { "<kolom>": { "before": <jsonb>, "after": <jsonb> } }
-- Satu baris = satu pengajuan, boleh beberapa field, diputuskan sebagai SATU paket
-- (Director tidak bisa menyetujui separuh — kalau bisa, hasilnya kombinasi yang tak
-- pernah ditinjau siapa pun).
create table if not exists finance_transaction_changes (
  id             bigserial primary key,
  transaction_id text not null references finance_transactions(id) on delete cascade,
  changes        jsonb not null,
  reason         text not null,
  status         finance_change_status_t not null default 'menunggu',
  requested_by   uuid,
  requested_at   timestamptz not null default now(),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  applied_at     timestamptz,
  constraint fin_change_reason_not_blank check (btrim(reason) <> ''),
  constraint fin_change_not_empty        check (changes <> '{}'::jsonb)
);
create index if not exists idx_fin_change_txn    on finance_transaction_changes(transaction_id);
create index if not exists idx_fin_change_status on finance_transaction_changes(status);

-- Satu transaksi maksimal SATU pengajuan menunggu. Tanpa ini, dua pengajuan yang
-- bertentangan bisa di-approve berurutan dan yang terakhir menang secara diam-diam.
create unique index if not exists uq_fin_change_one_pending
  on finance_transaction_changes(transaction_id)
  where status = 'menunggu';

-- ---------- 5. Nomor transaksi berurutan per bulan ----------
create or replace function next_finance_trx_id(p_month text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare seq int;
begin
  if p_month !~ '^\d{6}$' then
    raise exception 'Periode transaksi harus format YYYYMM, dapat "%"', p_month;
  end if;
  -- Advisory lock per bulan: dua request bersamaan tidak boleh dapat nomor sama.
  -- Dilepas otomatis saat transaksi selesai.
  perform pg_advisory_xact_lock(hashtext('finance_trx_id_' || p_month));
  select coalesce(max((split_part(id, '-', 3))::int), 0) + 1 into seq
  from finance_transactions
  where id like 'TRX-' || p_month || '-%';
  return 'TRX-' || p_month || '-' || lpad(seq::text, 4, '0');
end $$;

-- ---------- 6. PENJAGA: field terkunci tidak bisa di-UPDATE langsung ----------
-- Daftar field terkunci dibaca dari config saat runtime, bukan dibekukan di kode —
-- pemilik proses (Director/Finance Lead) bisa menggesernya tanpa deploy.
create or replace function guard_finance_txn_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  guarded text[];
  f       text;
  b       jsonb := to_jsonb(old);
  a       jsonb := to_jsonb(new);
begin
  -- apply_finance_change() menyetel flag transaction-local ini SETELAH memverifikasi
  -- ada pengajuan berstatus 'menunggu' yang diputuskan approve. Tidak ada jalur lain
  -- yang menyetelnya, jadi tidak ada jalur lain yang boleh menyentuh field terkunci.
  if coalesce(current_setting('mcn.finance_applying', true), '') = '1' then
    return new;
  end if;

  select array(select jsonb_array_elements_text(value)) into guarded
  from app_config where key = 'finance.guarded_fields';
  guarded := coalesce(guarded, '{}'::text[]);

  foreach f in array guarded loop
    if (b -> f) is distinct from (a -> f) then
      raise exception
        'Field "%" transaksi finance hanya bisa diubah lewat approval Director (finance_transaction_changes)', f
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_guard_finance_txn on finance_transactions;
create trigger trg_guard_finance_txn before update on finance_transactions
  for each row execute function guard_finance_txn_update();

-- ---------- 7. PENERAP: satu-satunya jalur sah ----------
-- Satu transaksi DB: verifikasi status → patch transaksi → tandai pengajuan approved.
-- Nilai baru diambil dari changes->'<field>'->'after' dan di-cast oleh
-- jsonb_populate_record (enum/date/numeric), jadi TIDAK ada dynamic SQL dan tidak ada
-- kolom di luar whitelist yang bisa tersentuh (id/created_by/created_at tak bisa
-- diselundupkan lewat payload pengajuan).
create or replace function apply_finance_change(
  p_request_id bigint,
  p_actor      uuid,
  p_note       text default null
) returns finance_transactions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  req     finance_transaction_changes;
  txn     finance_transactions;
  patched finance_transactions;
  patch   jsonb;
  bad_key text;
begin
  select * into req from finance_transaction_changes where id = p_request_id for update;
  if not found then
    raise exception 'Pengajuan perubahan % tidak ditemukan', p_request_id;
  end if;
  if req.status <> 'menunggu' then
    raise exception 'Pengajuan perubahan % sudah diputuskan (status: %)', p_request_id, req.status;
  end if;

  select * into txn from finance_transactions where id = req.transaction_id for update;
  if not found then
    raise exception 'Transaksi % tidak ditemukan', req.transaction_id;
  end if;

  select coalesce(jsonb_object_agg(key, value -> 'after'), '{}'::jsonb) into patch
  from jsonb_each(req.changes);

  select k into bad_key from jsonb_object_keys(patch) k
  where k not in (
    'direction','client_name','deal_id','creator_id','project_id','invoice_no','amount',
    'payment_method','payment_terms','payment_status','bank_name','bank_account_no',
    'bank_account_name','due_date','paid_at','notes'
  ) limit 1;
  if bad_key is not null then
    raise exception 'Field "%" tidak boleh diubah lewat pengajuan perubahan', bad_key;
  end if;

  patched := jsonb_populate_record(txn, to_jsonb(txn) || patch);

  perform set_config('mcn.finance_applying', '1', true);
  update finance_transactions set
    direction         = patched.direction,
    client_name       = patched.client_name,
    deal_id           = patched.deal_id,
    creator_id        = patched.creator_id,
    project_id        = patched.project_id,
    invoice_no        = patched.invoice_no,
    amount            = patched.amount,
    payment_method    = patched.payment_method,
    payment_terms     = patched.payment_terms,
    payment_status    = patched.payment_status,
    bank_name         = patched.bank_name,
    bank_account_no   = patched.bank_account_no,
    bank_account_name = patched.bank_account_name,
    due_date          = patched.due_date,
    paid_at           = patched.paid_at,
    notes             = patched.notes,
    updated_at        = now()
  where id = txn.id
  returning * into txn;
  perform set_config('mcn.finance_applying', '', true);

  update finance_transaction_changes set
    status        = 'approved',
    decided_by    = p_actor,
    decided_at    = now(),
    decision_note = p_note,
    applied_at    = now()
  where id = p_request_id;

  return txn;
end $$;

comment on function apply_finance_change(bigint, uuid, text) is
  'Terapkan pengajuan perubahan transaksi finance yang di-approve Director. Satu-satunya jalur yang boleh menyentuh field terkunci.';

-- ---------- 8. FK opsional: hanya dipasang bila tabel tujuan ada di host ----------
-- Nama tabel di sini = konvensi MCN MEA. Sesuaikan bila host memakai nama lain
-- (mis. `clients` bukan `brand_deals`); baris yang tabelnya tidak ada dilewati diam.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('finance_transactions','deal_id',       'brand_deals',      'id', 'fk_fin_txn_deal'),
      ('finance_transactions','creator_id',    'creators',         'id', 'fk_fin_txn_creator'),
      ('finance_transactions','project_id',    'special_projects', 'id', 'fk_fin_txn_project'),
      ('finance_transactions','created_by',    'team_members',     'id', 'fk_fin_txn_creator_by'),
      ('finance_transaction_changes','requested_by','team_members','id', 'fk_fin_chg_req_by'),
      ('finance_transaction_changes','decided_by',  'team_members','id', 'fk_fin_chg_dec_by')
    ) as v(src_table, src_col, tgt_table, tgt_col, fk_name)
  loop
    if to_regclass('public.' || t.tgt_table) is not null
       and not exists (select 1 from pg_constraint where conname = t.fk_name) then
      execute format('alter table %I add constraint %I foreign key (%I) references %I(%I)',
                     t.src_table, t.fk_name, t.src_col, t.tgt_table, t.tgt_col);
      raise notice 'FK % dipasang (% -> %)', t.fk_name, t.src_col, t.tgt_table;
    else
      raise notice 'FK % dilewati (tabel % tidak ada, atau FK sudah ada)', t.fk_name, t.tgt_table;
    end if;
  end loop;
end $$;

-- ---------- 9. ADAPTASI — RLS ----------
-- Model role tiap app berbeda, jadi bagian ini WAJIB disesuaikan, bukan di-copy buta.
-- Yang harus dijamin, apa pun bentuknya:
--   a. hanya divisi finance + management yang boleh SELECT (baris memuat rekening tujuan)
--   b. TIDAK ADA policy INSERT/UPDATE/DELETE untuk user biasa — semua mutasi lewat
--      server action yang sudah dicek izinnya; RLS di sini bukan pengganti trigger
--   c. principal eksternal (portal klien/kreator) dan role oversight read-only ditolak
-- Versi MCN MEA (contoh; helper is_management()/current_member_role()/is_creator_user()/
-- is_od_viewer() adalah milik app itu) ada di supabase/migrations/0032_finance_transactions.sql §7.
alter table finance_transactions        enable row level security;
alter table finance_transaction_changes enable row level security;

-- ---------- 10. Config: daftar field terkunci ----------
-- Terkunci = bernilai uang, tujuan uang, atau identitas pihak yang dibayar.
-- Di luar daftar ini (notes/keterangan) berlaku langsung + audit.
insert into app_config (key, value) values
  ('finance.guarded_fields',
   '["direction","client_name","deal_id","creator_id","project_id","invoice_no","amount","payment_method","payment_terms","payment_status","bank_name","bank_account_no","bank_account_name","due_date","paid_at"]'::jsonb)
on conflict (key) do nothing;
