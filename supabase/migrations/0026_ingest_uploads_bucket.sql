-- 0026 — Storage bucket for large weekly platform uploads (MCN/TAP/Shopee).
--
-- Problem (feedback tim ingest): file export platform mingguan bisa mencapai
-- ~61.000 baris (belasan–puluhan MB). Upload lewat Server Action Next.js kena
-- limit body serverless Vercel (~4,5MB, terlepas dari bodySizeLimit di
-- next.config), sehingga "tidak bisa upload banyak". Kalau dipecah manual,
-- semantik replace PER (kreator × minggu) di writeAggregates membuat potongan
-- berikutnya menimpa potongan sebelumnya untuk kreator yang barisnya terbelah
-- antar file ("replace bukan append").
--
-- Solusi: browser mengunggah file UTUH langsung ke Supabase Storage (mem-bypass
-- fungsi serverless), lalu Server Action tipis hanya menerima PATH objek,
-- mengunduh file di server via service-role, menjalankan pipeline parse →
-- agregat → drop-raw yang sudah ada tanpa perubahan, lalu MENGHAPUS objeknya
-- (raw tetap tidak pernah dipersistkan — CLAUDE.md). File utuh ⇒ tidak ada
-- pemecahan ⇒ tidak ada kehilangan data akibat replace.
--
-- Bucket privat, transient (dibersihkan server setelah diproses). Batas 100MB
-- memberi ruang untuk CSV ~61k baris (perkiraan ~25MB) + margin.

insert into storage.buckets (id, name, public, file_size_limit)
values ('ingest-uploads', 'ingest-uploads', false, 104857600)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- RLS storage.objects: pengguna terautentikasi hanya boleh menulis/membaca/
-- menghapus objek DI DALAM folder uid mereka sendiri (segmen pertama path =
-- auth.uid()). Server (service-role, createAdminClient) mem-bypass RLS untuk
-- download + cleanup. Tidak ada akses publik.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ingest_uploads_insert_own'
  ) then
    create policy "ingest_uploads_insert_own"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'ingest-uploads'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ingest_uploads_select_own'
  ) then
    create policy "ingest_uploads_select_own"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'ingest-uploads'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'ingest_uploads_delete_own'
  ) then
    create policy "ingest_uploads_delete_own"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'ingest-uploads'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
