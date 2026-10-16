"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { brandProgressTone } from "@/lib/m7/project-brands";
import {
  addProjectBrand, removeProjectBrand, searchProjectBrandShops, updateProjectTargetBrands,
  type BrandShopOption,
} from "./brand-actions";

/** Satu brand yang sudah bergabung ke project (special_project_brands). */
export interface ProjectBrandRow {
  id: number;
  brandName: string;
  shopKey: string | null;
  bizdevId: string | null;
  bizdevName: string | null;
  joinedAt: string;
  notes: string | null;
}

export interface BizdevOption {
  id: string;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const inputCls = "rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * Brand Bergabung (migrasi 0091): target jumlah brand vs brand yang sudah bergabung,
 * daftar brand-nya, dan rekap per BizDev pencarinya. Jumlah = jumlah baris; tidak
 * ada angka kedua yang disimpan.
 */
export function ProjectBrandsPanel({
  projectId,
  targetBrands,
  brands,
  canManage,
  canEditTarget,
  bizdevOptions,
  viewerId,
}: {
  projectId: number;
  targetBrands: number | null;
  brands: ProjectBrandRow[];
  /** m7.brands atau man power project ini — tambah/hapus brand. */
  canManage: boolean;
  /** m7.edit_target — ubah target jumlah brand. */
  canEditTarget: boolean;
  bizdevOptions: BizdevOption[];
  viewerId: string;
}) {
  const joined = brands.length;

  // Rekap per BizDev, terbanyak dulu.
  const perBizdev = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of brands) {
      const name = b.bizdevName ?? "Tanpa BizDev";
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "id"));
  }, [brands]);

  return (
    <section id="brand" className="mt-8 scroll-mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">
          Brand Bergabung{" "}
          <span className={brandProgressTone(joined, targetBrands)}>
            ({targetBrands ? `${joined} / ${targetBrands}` : joined})
          </span>
        </h2>
        {canEditTarget && <TargetBrandsEdit projectId={projectId} initial={targetBrands} />}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Target jumlah brand ditetapkan di awal project; brand dicari oleh BizDev. Pilih brand dari tab Deal Brand
        bila sudah terdaftar, atau ketik namanya kalau belum.
        {targetBrands && joined < targetBrands ? ` Kurang ${targetBrands - joined} brand lagi.` : ""}
      </p>

      {perBizdev.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {perBizdev.map(([name, n]) => (
            <span key={name} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
              {name}: <strong>{n}</strong> brand
            </span>
          ))}
        </div>
      )}

      {canManage && <AddBrandForm projectId={projectId} bizdevOptions={bizdevOptions} viewerId={viewerId} />}

      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">No</th>
              <th className="px-4 py-3">Brand</th>
              <th className="px-4 py-3">Shop (Deal Brand)</th>
              <th className="px-4 py-3">BizDev</th>
              <th className="px-4 py-3">Tgl Bergabung</th>
              <th className="px-4 py-3">Catatan</th>
              {canManage && <th className="px-4 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {brands.map((b, i) => (
              <tr key={b.id}>
                <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                <td className="px-4 py-2 font-medium">{b.brandName}</td>
                <td className="px-4 py-2 text-slate-600">
                  {b.shopKey ?? <span className="text-xs text-slate-400">belum terdaftar</span>}
                </td>
                <td className="px-4 py-2">{b.bizdevName ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{b.joinedAt}</td>
                <td className="max-w-[260px] px-4 py-2 text-slate-600">{b.notes ?? "—"}</td>
                {canManage && (
                  <td className="px-4 py-2">
                    <RemoveBrandButton projectId={projectId} brand={b} />
                  </td>
                )}
              </tr>
            ))}
            {brands.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                  Belum ada brand yang bergabung.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TargetBrandsEdit({ projectId, initial }: { projectId: number; initial: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial !== null ? String(initial) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(initial !== null ? String(initial) : ""); setError(null); setEditing(true); }}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
      >
        {initial ? "Edit Target Brand" : "Set Target Brand"}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData();
        fd.set("project_id", String(projectId));
        fd.set("target_brands", value);
        startTransition(async () => {
          const res = await updateProjectTargetBrands(fd);
          if (res.ok) { setEditing(false); router.refresh(); }
          else setError(res.error);
        });
      }}
    >
      <input
        type="number" min="1" value={value} onChange={(e) => setValue(e.target.value)}
        placeholder="Target brand (kosong = tanpa target)"
        className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs" autoFocus
      />
      <button type="submit" disabled={pending}
        className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "…" : "Simpan"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={pending}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
        Batal
      </button>
      {error && <span className="ml-1 text-xs text-red-700">{error}</span>}
    </form>
  );
}

/**
 * Form tambah brand. Nama brand diketik bebas; saran shop dari tab Deal Brand muncul
 * saat mengetik (dicari di server, katalognya terlalu besar untuk dikirim ke klien).
 * Memilih saran mengisi nama + menautkan shop_key; mengetik ulang melepas tautannya.
 */
function AddBrandForm({
  projectId, bizdevOptions, viewerId,
}: {
  projectId: number;
  bizdevOptions: BizdevOption[];
  viewerId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [shop, setShop] = useState<BrandShopOption | null>(null);
  const [results, setResults] = useState<BrandShopOption[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const seqRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  // Pencatat yang BizDev otomatis jadi BizDev-nya; selain itu dipilih manual.
  const defaultBizdev = bizdevOptions.some((o) => o.id === viewerId) ? viewerId : "";

  useEffect(() => {
    const term = name.trim();
    const seq = ++seqRef.current;
    if (!showResults || term.length < 2 || shop) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchProjectBrandShops(projectId, term)
        .then((res) => {
          if (seq !== seqRef.current) return;
          setResults(res.ok ? res.shops : []);
          setSearching(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setResults([]);
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name, showResults, shop, projectId]);

  return (
    <form
      ref={formRef}
      className="mt-2 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        const fd = new FormData(e.currentTarget);
        fd.set("project_id", String(projectId));
        fd.set("brand_name", name);
        fd.set("shop_key", shop?.shop_key ?? "");
        startTransition(async () => {
          const res = await addProjectBrand(fd);
          if (res.ok) {
            setMessage({ ok: true, text: res.message ?? "Brand tercatat." });
            setName("");
            setShop(null);
            formRef.current?.reset();
            router.refresh();
          } else {
            setMessage({ ok: false, text: res.error });
          }
        });
      }}
    >
      <div className="relative lg:col-span-2">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setShop(null); setShowResults(true); }}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 150)}
          placeholder="Nama brand (ketik untuk cari di Deal Brand)"
          className={`${inputCls} w-full`}
          required
        />
        {shop && (
          <span className="mt-1 block text-xs text-green-700">
            Tertaut ke shop Deal Brand: {shop.shop_name ?? shop.shop_key}
            {shop.shop_id ? ` (#${shop.shop_id})` : ""}
          </span>
        )}
        {showResults && !shop && name.trim().length >= 2 && (
          <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {searching && <p className="px-3 py-2 text-xs text-slate-400">Mencari…</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">
                Tidak ada di Deal Brand — brand tetap bisa dicatat dengan nama ini.
              </p>
            )}
            {results.map((s) => (
              <button
                key={s.shop_key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setShop(s); setName(s.shop_name ?? s.shop_key); setShowResults(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                {s.shop_name ?? s.shop_key}
                {s.shop_id && <span className="ml-1 text-xs text-slate-400">#{s.shop_id}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <select name="bizdev_id" defaultValue={defaultBizdev} className={inputCls} aria-label="BizDev pencari brand">
        <option value="">— BizDev (default: saya) —</option>
        {bizdevOptions.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-xs text-slate-500">
        Bergabung
        <input type="date" name="joined_at" className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900" />
      </label>
      <input name="notes" placeholder="Catatan (opsional)" className={inputCls} />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 lg:col-start-5"
      >
        {pending ? "Menyimpan..." : "Tambah Brand"}
      </button>
      {message && (
        <p className={`text-xs sm:col-span-2 lg:col-span-4 lg:row-start-2 ${message.ok ? "text-green-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}

function RemoveBrandButton({ projectId, brand }: { projectId: number; brand: ProjectBrandRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Hapus brand "${brand.brandName}" dari project ini?`)) return;
          setError(null);
          const fd = new FormData();
          fd.set("project_id", String(projectId));
          fd.set("brand_id", String(brand.id));
          startTransition(async () => {
            const res = await removeProjectBrand(fd);
            if (res.ok) router.refresh();
            else setError(res.error);
          });
        }}
        className="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "…" : "Hapus"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
