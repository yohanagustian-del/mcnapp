-- ============================================================
-- 0032_finance_transactions.sql
-- Modul Finance — Transaksi & mekanisme ubah transaksi dengan approval Director.
--
-- LATAR BELAKANG (QA /finance/transactions/TRX-YYYYMM-NNNN)
-- Klien bisa mengubah metode pembayaran setelah transaksi tercatat (mis. dari
-- transfer bank ke virtual account, atau ganti rekening tujuan). Sebelum ini
-- tidak ada jalur legal untuk itu: satu-satunya cara adalah edit langsung di DB.
--
-- KEPUTUSAN ATURAN (mengubah house rule CLAUDE.md #3 — lihat CLAUDE.md #3 & #9):
-- Read-only absolut HANYA berlaku untuk field yang bersumber dari PLATFORM
-- (agency_links.link_status, creators.commission_share) — di situ edit manual
-- berarti memalsukan data platform. Transaksi finance BUKAN data platform: ia
-- catatan internal atas kesepakatan dengan klien, dan kesepakatan itu memang
-- bisa berubah. Jadi transaksi finance BOLEH diubah, TAPI:
--   1. hanya lewat change request (tidak ada UPDATE langsung),
--   2. field bernilai uang / tujuan pembayaran wajib approval Director,
--   3. semuanya masuk audit_logs.
-- Ini persis pola CLAUDE.md #2 ("aksi MANUSIA berpotensi merugikan perusahaan →
-- butuh approval sebelum berlaku"), bukan pengecualian terhadapnya.
--
-- Penegakan ada di DB, bukan cuma di server action: server action memakai
-- service-role (bypass RLS) sehingga satu-satunya penjaga yang tidak bisa
-- dilewati adalah TRIGGER. guard_finance_txn_update() menolak setiap UPDATE
-- yang menyentuh field terkunci kecuali dijalankan dari apply_finance_change().
-- ============================================================

-- ---------- 1. Enum ----------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'finance_payment_method_t') then
    create type finance_payment_method_t as enum (
      'transfer_bank','virtual_account','ewallet','qris','kartu_kredit','tunai','potong_komisi'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'finance_txn_direction_t') then
    create type finance_txn_direction_t as enum ('masuk','keluar');
  end if;
  if not exists (select 1 from pg_type where typname = 'finance_change_status_t') then
    create type finance_change_status_t as enum ('menunggu','approved','ditolak','dibatalkan');
  end if;
end $$;

-- ---------- 2. Transaksi ----------
-- id text PK format TRX-YYYYMM-NNNN (nomor urut per bulan, lihat next_finance_trx_id).
-- Sengaja tidak memakai genId() 5-char seperti CRT-/DEAL-/LNK-: nomor transaksi
-- finance dipakai manusia di invoice & rekonsiliasi bank, jadi harus berurutan
-- dan menunjukkan periode.
create table if not exists finance_transactions (
  id                  text primary key,
  direction           finance_txn_direction_t not null default 'masuk',
  client_name         text not null,
  deal_id             text references brand_deals(id),
  creator_id          text references creators(id),
  project_id          bigint references special_projects(id),
  invoice_no          text,
  amount              numeric not null check (amount >= 0),
  payment_method      finance_payment_method_t not null,
  payment_terms       payment_terms_t  not null default 'invoice',
  payment_status      payment_status_t not null default 'pending',
  bank_name           text,
  bank_account_no     text,
  bank_account_name   text,
  due_date            date,
  paid_at             date,
  notes               text,
  created_by          uuid references team_members(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_fin_txn_status  on finance_transactions(payment_status);
create index if not exists idx_fin_txn_deal    on finance_transactions(deal_id);
create index if not exists idx_fin_txn_creator on finance_transactions(creator_id);
create index if not exists idx_fin_txn_created on finance_transactions(created_at desc);

comment on table finance_transactions is
  'Transaksi finance (catatan internal pembayaran klien). Field terkunci (app_config finance.guarded_fields) hanya bisa berubah lewat finance_transaction_changes + approval Director.';

-- ---------- 3. Change request ----------
-- changes = { "<kolom>": { "before": <jsonb>, "after": <jsonb> } }
-- Satu baris = satu pengajuan (boleh beberapa field sekaligus, diputuskan sebagai satu paket).
create table if not exists finance_transaction_changes (
  id             bigserial primary key,
  transaction_id text not null references finance_transactions(id) on delete cascade,
  changes        jsonb not null,
  reason         text not null,
  status         finance_change_status_t not null default 'menunggu',
  requested_by   uuid references team_members(id),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references team_members(id),
  decided_at     timestamptz,
  decision_note  text,
  applied_at     timestamptz,
  constraint fin_change_reason_not_blank check (btrim(reason) <> ''),
  constraint fin_change_not_empty        check (changes <> '{}'::jsonb)
);
create index if not exists idx_fin_change_txn    on finance_transaction_changes(transaction_id);
create index if not exists idx_fin_change_status on finance_transaction_changes(status);

-- Satu transaksi hanya boleh punya SATU pengajuan menunggu — kalau tidak, dua
-- pengajuan yang saling bertentangan bisa di-approve berurutan dan yang terakhir
-- menang secara diam-diam.
create unique index if not exists uq_fin_change_one_pending
  on finance_transaction_changes(transaction_id)
  where status = 'menunggu';

comment on table finance_transaction_changes is
  'Pengajuan perubahan transaksi finance oleh Senior/Lead Finance. status menunggu → approved (diterapkan apply_finance_change) | ditolak | dibatalkan.';

-- ---------- 4. Nomor transaksi berurutan per bulan ----------
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

-- ---------- 5. Penjaga: field terkunci tidak bisa di-UPDATE langsung ----------
-- Daftar field terkunci dibaca dari app_config (CLAUDE.md: jangan hardcode).
create or replace function guard_finance_txn_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  guarded text[];
  f       text;
  b       jsonb := to_jsonb(old);
  a       jsonb := to_jsonb(new);
begin
  -- apply_finance_change() menyetel flag transaction-local ini setelah memverifikasi
  -- bahwa ada change request ber-status 'menunggu' yang di-approve Director.
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

-- ---------- 6. Terapkan change request yang di-approve ----------
-- Satu transaksi DB: verifikasi status → patch transaksi → tandai request approved.
-- Dipanggil server action lewat rpc('apply_finance_change'). Nilai baru diambil dari
-- changes->'<field>'->'after' dan di-cast oleh jsonb_populate_record (enum/date/numeric),
-- jadi tidak ada dynamic SQL dan tidak ada kolom di luar whitelist yang bisa tersentuh.
create or replace function apply_finance_change(
  p_request_id bigint,
  p_actor      uuid,
  p_note       text default null
) returns finance_transactions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  req      finance_transaction_changes;
  txn      finance_transactions;
  patched  finance_transactions;
  patch    jsonb;
  bad_key  text;
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

  -- Whitelist kolom yang boleh diubah. id/created_by/created_at/updated_at TIDAK termasuk:
  -- identitas & jejak pembuatan transaksi tidak pernah berubah, hanya isinya.
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

-- ---------- 7. RLS ----------
-- Mutasi seluruhnya lewat server action (service-role) + requirePermission; di sini
-- hanya izin BACA. Dimensi pembayaran = management + finance (lead & staff) + bd_admin
-- (invoicing, CLAUDE.md RBAC). creator_user & od_viewer ditolak: transaksi finance
-- memuat rekening tujuan, di luar cakupan portal kreator dan oversight OD.
alter table finance_transactions        enable row level security;
alter table finance_transaction_changes enable row level security;

drop policy if exists fin_txn_select on finance_transactions;
create policy fin_txn_select on finance_transactions
  for select to authenticated
  using (
    public.is_management()
    or public.current_member_role() in ('finance_lead','finance','bd_admin')
  );

drop policy if exists fin_change_select on finance_transaction_changes;
create policy fin_change_select on finance_transaction_changes
  for select to authenticated
  using (
    public.is_management()
    or public.current_member_role() in ('finance_lead','finance','bd_admin')
  );

drop policy if exists fin_txn_deny_external on finance_transactions;
create policy fin_txn_deny_external on finance_transactions
  as restrictive for select using (not is_creator_user() and not is_od_viewer());

drop policy if exists fin_change_deny_external on finance_transaction_changes;
create policy fin_change_deny_external on finance_transaction_changes
  as restrictive for select using (not is_creator_user() and not is_od_viewer());

-- ---------- 8. app_config ----------
-- Field terkunci = bernilai uang, tujuan uang, atau identitas pihak yang dibayar.
-- Di luar daftar ini (notes/keterangan) berlaku langsung + audit (CLAUDE.md #2:
-- tidak merugikan → auto). Director bisa menggeser daftar ini tanpa deploy.
insert into app_config (key, value) values
  ('finance.guarded_fields',
   '["direction","client_name","deal_id","creator_id","project_id","invoice_no","amount","payment_method","payment_terms","payment_status","bank_name","bank_account_no","bank_account_name","due_date","paid_at"]'::jsonb)
on conflict (key) do nothing;
