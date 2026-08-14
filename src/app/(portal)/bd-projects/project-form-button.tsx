"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_SHOP_LIMIT, PROJECT_STATUSES } from "@/lib/deals/bd-project";
import { saveBdProject, type ProjectFormState } from "./actions";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/** Satu pilihan brand/shop = satu baris tabel "Shop dari Produk TAP". */
export interface ShopOption {
  shop_key: string;
  shop_name: string | null;
  shop_id: string | null;
  product_count: number;
}

/**
 * Form "Tambah Project" / "Edit Project" (tab Project BD).
 *
 * Isinya nama project (teks bebas) + pilihan brand/shop yang digarap. Shop-nya
 * datang dari tabel "Shop dari Produk TAP" di tab Deal Brand — sumber yang sama,
 * bukan daftar brand tersendiri yang harus dijaga sinkron (CLAUDE.md #4).
 *
 * Pemilihannya sengaja BUKAN <select multiple>: daftar shop bisa ratusan baris dan
 * ctrl-klik di listbox panjang mudah menghapus pilihan yang sudah benar tanpa
 * disadari. Yang dipakai: satu kotak cari + daftar checkbox yang tersaring
 * seketika, chip untuk yang sudah terpilih (bisa dilepas satu-satu), dan tombol
 * "pilih semua hasil pencarian" untuk memilih sekelompok brand sekaligus.
 */
export function ProjectFormButton({
  shops,
  project,
  label = "+ Tambah Project",
  className = "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700",
}: {
  shops: ShopOption[];
  /** Kosong = tambah project baru; terisi = ubah project yang sudah ada. */
  project?: {
    id: string;
    name: string;
    status: string;
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

  const shopByKey = useMemo(() => new Map(shops.map((s) => [s.shop_key, s])), [shops]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter((s) =>
      [s.shop_name, s.shop_id, s.shop_key].some((v) => v?.toLowerCase().includes(q))
    );
  }, [shops, query]);

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
                        {shopByKey.get(key)?.shop_name ?? key} ✕
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
                        ...filtered.map((s) => s.shop_key).filter((k) => !prev.includes(k)),
                      ])
                    }
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                  >
                    Pilih semua hasil ({filtered.length})
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
                  {filtered.map((s) => (
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
                  {filtered.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-slate-400">
                      {shops.length === 0
                        ? "Belum ada shop di katalog Produk TAP. Daftarkan deal atau upload master product list dulu."
                        : `Tidak ada shop cocok dengan "${query}".`}
                    </p>
                  )}
                </div>

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
