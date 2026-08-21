"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PROJECT_SHOP_LIMIT,
  PROJECT_STATUSES,
  PAYMENT_STATUSES,
  SHOP_PICKER_LIMIT,
} from "@/lib/deals/bd-project";
import { saveBdProject, searchProjectShops, type ProjectFormState, type ShopOption } from "./actions";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** Jeda sebelum ketikan dikirim sebagai query — cukup untuk tidak menembak tiap huruf. */
const SEARCH_DEBOUNCE_MS = 250;

export type { ShopOption };

/**
 * Form "Tambah Project" / "Edit Project" (tab Project BD).
 *
 * Isinya nama project (teks bebas) + pilihan brand/shop yang digarap. Shop-nya
 * datang dari tabel "Shop dari Produk TAP" di tab Deal Brand — sumber yang sama,
 * bukan daftar brand tersendiri yang harus dijaga sinkron (CLAUDE.md #4).
 *
 * Pemilihannya sengaja BUKAN <select multiple>: daftar shop bisa ratusan baris dan
 * ctrl-klik di listbox panjang mudah menghapus pilihan yang sudah benar tanpa
 * disadari. Yang dipakai: satu kotak cari + daftar checkbox, chip untuk yang sudah
 * terpilih (bisa dilepas satu-satu), dan tombol "pilih semua yang tampil".
 *
 * PENCARIANNYA DI SERVER (searchProjectShops), bukan saringan atas daftar yang sudah
 * dimuat. Katalog shop belasan ribu baris: memuat sepotong lalu menyaringnya di klien
 * berarti shop di luar potongan itu tidak bisa ditemukan sama sekali — bug yang
 * membuat "Dua Belibis" (urutan ke-1073) tak muncul di sini padahal ada di tab Deal
 * Brand. `initialShops` hanya isi awal daftar sebelum orang mengetik.
 */
export function ProjectFormButton({
  initialShops,
  knownShops,
  project,
  label = "+ Tambah Project",
  className = "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700",
}: {
  /** Isi daftar saat kotak cari masih kosong — bukan seluruh katalog shop. */
  initialShops: ShopOption[];
  /**
   * Shop yang namanya sudah diketahui pemanggil (mis. anggota project yang sedang
   * diedit), supaya chip-nya bernama benar walau tidak ada di hasil cari saat ini.
   */
  knownShops?: ShopOption[];
  /** Kosong = tambah project baru; terisi = ubah project yang sudah ada. */
  project?: {
    id: string;
    name: string;
    status: string;
    status_payment?: string | null;
    notes: string | null;
    shop_keys: string[];
  };
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(project?.shop_keys ?? []);
  const [results, setResults] = useState<ShopOption[]>(initialShops);
  const [capped, setCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Nama shop yang pernah terlihat, supaya chip pilihan tetap bernama benar setelah
  // hasil pencarian berganti dan shop itu tidak lagi ada di daftar.
  const [known, setKnown] = useState<Record<string, ShopOption>>(() => {
    const seed: Record<string, ShopOption> = {};
    for (const s of [...initialShops, ...(knownShops ?? [])]) seed[s.shop_key] = s;
    return seed;
  });
  const [state, formAction, pending] = useActionState<ProjectFormState | null, FormData>(
    saveBdProject,
    null
  );

  const isNew = !project;

  useEffect(() => {
    if (!state?.ok) return;
    setOpen(false);
    // Project baru langsung dibuka detailnya: yang dicari orang setelah membuat
    // project adalah isinya, bukan kembali ke daftar.
    if (isNew && state.projectId) router.push(`/bd-projects/${state.projectId}`);
    else router.refresh();
  }, [state, isNew, router]);

  // Balasan yang datang telat tidak boleh menimpa hasil ketikan yang lebih baru:
  // tiap permintaan bernomor, dan hanya nomor terakhir yang boleh menulis state.
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    const seq = ++seqRef.current;

    // Kotak cari kosong = daftar bawaan yang sudah ikut terkirim bersama halaman.
    // Tidak perlu bolak-balik ke server untuk menampilkan yang sudah ada di tangan.
    if (!term) {
      setResults(initialShops);
      setCapped(false);
      setSearching(false);
      setSearchError(null);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      searchProjectShops(term)
        .then((res) => {
          if (seq !== seqRef.current) return;
          setResults(res.shops);
          setCapped(res.capped);
          setSearchError(null);
          setKnown((prev) => {
            const next = { ...prev };
            for (const s of res.shops) next[s.shop_key] = s;
            return next;
          });
        })
        .catch((e: unknown) => {
          if (seq !== seqRef.current) return;
          // Gagal cari ≠ tidak ada hasil. Dibedakan supaya orang tidak menyimpulkan
          // shopnya memang tidak ada padahal querynya yang tidak sampai.
          setResults([]);
          setCapped(false);
          setSearchError(e instanceof Error ? e.message : "Pencarian shop gagal");
        })
        .finally(() => {
          if (seq === seqRef.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [open, query, initialShops]);

  const selectedSet = new Set(selected);
  const overLimit = selected.length > PROJECT_SHOP_LIMIT;

  function toggle(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function openModal() {
    // Modal yang pernah dibatalkan tidak boleh terbuka lagi membawa pilihan yang
    // tidak jadi disimpan.
    setSelected(project?.shop_keys ?? []);
    setQuery("");
    setResults(initialShops);
    setCapped(false);
    setSearchError(null);
    setOpen(true);
  }

  const err = (field: string) => state?.fieldErrors?.[field];

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {label}
      </button>

      {state && !state.ok && !open && (
        <span className="ml-2 text-xs text-red-600" role="alert">
          {state.message}
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={isNew ? "Tambah Project BD" : `Edit project ${project?.name}`}
        >
          <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              {isNew ? "Tambah Project" : "Edit Project"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Pilih brand/shop dari tabel <strong>Shop dari Produk TAP</strong> (tab Deal Brand).
              Angka project — kartu produk, ads budget, GMV — dibaca dari sana, tidak diisi manual.
            </p>

            <form action={formAction} className="mt-4">
              {!isNew && <input type="hidden" name="project_id" value={project.id} />}
              <input type="hidden" name="shop_keys" value={JSON.stringify(selected)} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block text-sm font-medium sm:col-span-2">
                  Nama Project *
                  <input
                    name="name"
                    required
                    defaultValue={project?.name ?? ""}
                    placeholder="Payday Agustus — Skincare"
                    className={inputCls}
                  />
                  {err("name") && (
                    <span className="mt-1 block text-xs font-normal text-red-600">{err("name")}</span>
                  )}
                </label>
                <label className="block text-sm font-medium">
                  Status
                  <select name="status" defaultValue={project?.status ?? "running"} className={inputCls}>
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-3 block text-sm font-medium">
                Status Payment
                <select name="status_payment" defaultValue={project?.status_payment ?? ""} className={inputCls}>
                  <option value="">Pilih status…</option>
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-3 block text-sm font-medium">
                Catatan
                <textarea
                  name="notes"
                  rows={2}
                  defaultValue={project?.notes ?? ""}
                  placeholder="Konteks project, PIC, kesepakatan khusus…"
                  className={inputCls}
                />
              </label>

              <fieldset className="mt-4 rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-sm font-medium">
                  Brand / Shop * ({selected.length} terpilih)
                </legend>

                {selected.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {selected.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggle(key)}
                        title="Klik untuk melepas"
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-red-100 hover:text-red-700"
                      >
                        {known[key]?.shop_name ?? key} ✕
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari nama shop / Shop ID…"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((prev) => [
                        ...prev,
                        ...results.map((s) => s.shop_key).filter((k) => !prev.includes(k)),
                      ])
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {/* "yang tampil", bukan "semua hasil": kalau hasilnya kena batas,
                        yang terpilih hanya sebagian dari yang cocok. */}
                    Pilih semua yang tampil ({results.length})
                  </button>
                  {selected.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelected([])}
                      className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                    >
                      Kosongkan
                    </button>
                  )}
                </div>

                <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-slate-200">
                  {results.map((s) => (
                    <label
                      key={s.shop_key}
                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(s.shop_key)}
                        onChange={() => toggle(s.shop_key)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1 truncate">
                        {s.shop_name ?? <span className="text-slate-400">{s.shop_key}</span>}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">{s.shop_id ?? "—"}</span>
                      <span className="text-[11px] text-slate-400">{s.product_count} kartu</span>
                    </label>
                  ))}
                  {results.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-slate-400">
                      {searching
                        ? "Mencari…"
                        : searchError
                          ? searchError
                          : query.trim()
                            ? `Tidak ada shop cocok dengan "${query.trim()}".`
                            : "Belum ada shop di katalog. Daftarkan deal atau upload master product list dulu."}
                    </p>
                  )}
                </div>

                {/* Batas hasil dikatakan, bukan disembunyikan: tanpa ini daftar yang
                    terpotong terbaca seolah itulah semua shop yang cocok. */}
                <p className="mt-1 text-[11px] text-slate-400">
                  {searching
                    ? "Mencari di katalog shop…"
                    : capped
                      ? `Ditampilkan ${SHOP_PICKER_LIMIT} shop teratas — masih ada yang cocok. Persempit pencarian (mis. ketik Shop ID).`
                      : query.trim()
                        ? `${results.length} shop cocok.`
                        : `Daftar awal ${results.length} shop dengan kartu terbanyak. Ketik untuk mencari seluruh katalog — termasuk shop yang belum punya kartu produk.`}
                </p>

                {err("shop_keys") && (
                  <span className="mt-1 block text-xs text-red-600">{err("shop_keys")}</span>
                )}
                {overLimit && (
                  <span className="mt-1 block text-xs text-red-600" role="alert">
                    Maksimal {PROJECT_SHOP_LIMIT} shop per project.
                  </span>
                )}
              </fieldset>

              {state && !state.ok && (
                <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700" role="alert">
                  {state.message}
                </p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending || selected.length === 0 || overLimit}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {pending ? "Menyimpan…" : isNew ? "Simpan Project" : "Simpan Perubahan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
