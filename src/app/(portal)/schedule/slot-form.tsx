"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { LiveScheduleSlot, SlotStatus } from "@/lib/schedule/types";
import { SHOP_PICKER_LIMIT } from "@/lib/deals/shop-search";
import {
  createSlotAction,
  deleteSlotAction,
  updateSlotAction,
  searchShopDealsAction,
  type ShopDealOption,
} from "./actions";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnGhost = "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
const btnDanger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

/** Jeda sebelum ketikan dikirim sebagai query — cukup untuk tidak menembak tiap huruf. */
const SEARCH_DEBOUNCE_MS = 250;

export type { ShopDealOption };

/**
 * Pemilih brand untuk "Link ke deal (opsional)".
 *
 * SENGAJA BUKAN <select> berisi daftar yang sudah dimuat. Katalog shop 16.030 baris:
 * daftar sepanjang apa pun yang dikirim ke klien menyembunyikan sisanya, dan yang
 * tersembunyi tidak bisa dicari sama sekali. Versi lama memuat 500 baris teratas
 * menurut jumlah kartu lalu MENGURUTKANNYA ULANG per nama, jadi shop mana yang
 * terpotong pun tak bisa ditebak pemakai.
 *
 * Gantinya kotak cari yang menembak SQL (searchShopDealsAction) — definisi pencarian
 * yang sama dengan pemilih shop di form Project BD dan kotak cari tabel Shop di tab
 * Deal Brand (CLAUDE.md #4). Terlipat saat tidak dipakai supaya form slot tetap ringkas.
 */
function ShopDealPicker({
  initialValue,
  initialShops,
  disabled,
  onPicked,
}: {
  initialValue: string;
  /** Isi daftar sebelum pemakai mengetik — bukan seluruh katalog shop. */
  initialShops: ShopDealOption[];
  disabled: boolean;
  /** Dipanggil HANYA saat pemakai memilih; dipakai mengisi otomatis kolom Brand. */
  onPicked: (shop: ShopDealOption | null) => void;
}) {
  const [shopKey, setShopKey] = useState(initialValue);
  const [selected, setSelected] = useState<ShopDealOption | null>(
    () => initialShops.find((s) => s.shop_key === initialValue) ?? null
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShopDealOption[]>(initialShops);
  const [capped, setCapped] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Balasan yang datang telat tidak boleh menimpa hasil ketikan yang lebih baru.
  const seqRef = useRef(0);

  // Slot lama bisa menaut shop yang tidak ada di daftar awal (isinya cuma 50 baris
  // teratas). Namanya dijemput sekali supaya keterangan "ada PIC TAP" tetap benar.
  // TIDAK memanggil onPicked: ini melengkapi data yang sudah tersimpan, bukan pilihan
  // baru pemakai — memanggilnya akan menimpa kolom Brand yang sudah diisi.
  useEffect(() => {
    if (!initialValue || selected) return;
    let alive = true;
    searchShopDealsAction(initialValue)
      .then((res) => {
        if (!alive || !res.ok) return;
        const exact = res.shops.find((s) => s.shop_key === initialValue);
        if (exact) setSelected(exact);
      })
      .catch(() => {
        // Gagal melengkapi nama bukan alasan menghalangi penyuntingan slot: labelnya
        // jatuh ke shop_key, yang memang sudah berisi nama shopnya.
      });
    return () => {
      alive = false;
    };
  }, [initialValue, selected]);

  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    const seq = ++seqRef.current;

    // Kotak cari kosong = daftar bawaan yang sudah ikut terkirim bersama halaman.
    if (!term) {
      setResults(initialShops);
      setCapped(false);
      setSearching(false);
      setError(null);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      searchShopDealsAction(term)
        .then((res) => {
          if (seq !== seqRef.current) return;
          if (res.ok) {
            setResults(res.shops);
            setCapped(res.capped);
            setError(null);
          } else {
            // Gagal cari ≠ tidak ada hasil. Dibedakan supaya orang tidak menyimpulkan
            // brandnya memang tidak ada padahal querynya yang tidak sampai.
            setResults([]);
            setCapped(false);
            setError(res.error);
          }
          setSearching(false);
        })
        .catch((e: unknown) => {
          if (seq !== seqRef.current) return;
          setResults([]);
          setCapped(false);
          setError(e instanceof Error ? e.message : "Pencarian brand gagal");
          setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [open, query, initialShops]);

  function pick(shop: ShopDealOption | null) {
    setShopKey(shop?.shop_key ?? "");
    setSelected(shop);
    setOpen(false);
    setQuery("");
    onPicked(shop);
  }

  // shop_key sudah berisi Shop Name, jadi slot yang shopnya belum sempat dijemput
  // tetap tampil bernama — bukan kunci mentah yang tak berarti bagi pemakai.
  const label = selected
    ? `${selected.shop_name ?? selected.shop_key}${selected.shop_id ? ` (${selected.shop_id})` : ""}`
    : shopKey || null;

  const rowCls =
    "flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-left text-sm last:border-b-0 hover:bg-slate-50";

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">Link ke deal (opsional)</label>
      <input type="hidden" name="shop_key" value={shopKey} />

      <div className="mt-1 flex items-center gap-2">
        <span
          className={`flex-1 truncate rounded-md border border-slate-300 px-3 py-2 text-sm ${
            label ? "" : "text-slate-400"
          }`}
        >
          {label ?? "— tidak ada —"}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-md border border-slate-300 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {open ? "Tutup" : label ? "Ganti" : "Pilih"}
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="mt-2 rounded-md border border-slate-200 p-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama brand / Shop ID…"
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />

          <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200">
            <button type="button" onClick={() => pick(null)} className={`${rowCls} text-slate-400`}>
              — tidak ada —
            </button>
            {results.map((s) => (
              <button key={s.shop_key} type="button" onClick={() => pick(s)} className={rowCls}>
                <span className="flex-1 truncate">{s.shop_name ?? s.shop_key}</span>
                <span className="font-mono text-[11px] text-slate-400">{s.shop_id ?? "—"}</span>
                {s.has_pic_tap && (
                  <span className="shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-800">
                    PIC TAP
                  </span>
                )}
              </button>
            ))}
            {results.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-slate-400">
                {searching
                  ? "Mencari…"
                  : error
                    ? error
                    : query.trim()
                      ? `Tidak ada brand cocok dengan "${query.trim()}".`
                      : "Belum ada shop di katalog."}
              </p>
            )}
          </div>

          {/* Batas hasil dikatakan, bukan disembunyikan: tanpa ini daftar yang
              terpotong terbaca seolah itulah semua brand yang cocok. */}
          <p className="mt-1 text-[11px] leading-tight text-slate-400">
            {searching
              ? "Mencari di katalog shop…"
              : capped
                ? `Ditampilkan ${SHOP_PICKER_LIMIT} teratas — masih ada yang cocok. Persempit pencarian (mis. ketik Shop ID).`
                : query.trim()
                  ? `${results.length} brand cocok.`
                  : `Daftar awal ${results.length} brand dengan kartu terbanyak. Ketik untuk mencari seluruh katalog.`}
          </p>
        </div>
      )}

      <p className="mt-1 text-[11px] leading-tight text-slate-400">
        Daftar brand diambil dari tabel <strong>Shop</strong> di tab Deal Brand — termasuk
        brand yang dealnya sudah terdaftar tapi kartu produknya belum turun.
        {selected?.has_pic_tap && (
          <>
            {" "}
            Brand ini punya <strong>PIC TAP</strong> — jadwal ini akan muncul sebagai
            notifikasi di akun PIC tersebut.
          </>
        )}
      </p>
    </div>
  );
}

export interface RosterCreatorOption {
  id: string;
  name: string;
  username: string | null;
}

/**
 * Create/edit form for a single live-schedule slot. Rendered inside a modal-ish panel
 * by the client calendar wrapper (schedule-board.tsx). `slot` is null for create mode
 * (prefilled with creatorId/date), non-null for edit mode.
 */
export function SlotForm({
  slot,
  creatorId,
  date,
  creators,
  initialShops,
  onDone,
  onCancel,
}: {
  slot: LiveScheduleSlot | null;
  creatorId: string;
  date: string;
  creators: RosterCreatorOption[];
  /** Isi awal pemilih brand; pencariannya sendiri dikerjakan server. */
  initialShops: ShopDealOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<SlotStatus>(slot?.status === "done" ? "scheduled" : slot?.status ?? "scheduled");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [brandName, setBrandName] = useState(slot?.brand_name ?? "");
  const isEdit = slot !== null;
  const locked = slot?.status === "done";

  /**
   * Memilih shop ikut mengisi kolom "Brand (bebas teks)" SELAMA kolom itu masih
   * kosong — brand di jadwal hampir selalu sama dengan nama shopnya, dan mengetik
   * ulang hanya melahirkan ejaan berbeda untuk brand yang sama. Kolomnya tetap bisa
   * diubah manual, dan isian yang sudah ada tidak pernah ditimpa.
   */
  function onShopPicked(shop: ShopDealOption | null) {
    if (shop && brandName.trim() === "") setBrandName(shop.shop_name ?? shop.shop_key);
  }

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = isEdit
        ? await updateSlotAction(formData)
        : await createSlotAction(formData);
      if (res.ok) {
        onDone();
      } else {
        setError(res.error);
      }
    });
  }

  function onDelete() {
    if (!slot) return;
    if (!confirm("Hapus slot ini?")) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("slot_id", String(slot.id));
      const res = await deleteSlotAction(fd);
      if (res.ok) {
        onDone();
      } else {
        setError(res.error);
      }
    });
  }

  const creatorName =
    creators.find((c) => c.id === creatorId)?.name ?? creatorId;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">
          {isEdit ? "Edit Slot" : "Slot Baru"} — {creatorName} · {date}
        </h3>
        <button type="button" onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600">
          Tutup
        </button>
      </div>

      {locked && (
        <p className="mt-2 rounded-md bg-slate-100 p-2 text-xs text-slate-600">
          Slot sudah diverifikasi (done) — terkunci, tidak dapat diubah.
        </p>
      )}

      <form action={onSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="creator_id" value={creatorId} />
        <input type="hidden" name="schedule_date" value={date} />
        {isEdit && <input type="hidden" name="slot_id" value={slot!.id} />}

        <div>
          <label className="block text-xs font-medium text-slate-600">Status</label>
          <div className="mt-1 flex gap-3 text-sm">
            {(["scheduled", "tentative", "off"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input
                  type="radio" name="status" value={s} checked={status === s}
                  disabled={locked}
                  onChange={() => setStatus(s)}
                />
                {s === "scheduled" ? "Terjadwal" : s === "tentative" ? "Tentatif" : "OFF"}
              </label>
            ))}
          </div>
        </div>

        {status === "off" ? (
          <div>
            <label className="block text-xs font-medium text-slate-600">Alasan OFF</label>
            <input
              name="off_reason" disabled={locked}
              defaultValue={slot?.off_reason ?? ""}
              placeholder="mis. pulang kampung"
              className={input}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Jam mulai</label>
              <input
                type="time" name="start_time" disabled={locked}
                defaultValue={slot?.start_time?.slice(0, 5) ?? ""}
                className={input}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Jam selesai</label>
              <input
                type="time" name="end_time" disabled={locked}
                defaultValue={slot?.end_time?.slice(0, 5) ?? ""}
                className={input}
              />
            </div>
          </div>
        )}

        {status !== "off" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">Brand (bebas teks)</label>
                <input
                  name="brand_name" disabled={locked}
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="mis. MIX Brand / Organik"
                  className={input}
                />
              </div>
              <ShopDealPicker
                initialValue={slot?.shop_key ?? ""}
                initialShops={initialShops}
                disabled={locked}
                onPicked={onShopPicked}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">Deal oleh</label>
                <select name="deals_by" disabled={locked} defaultValue={slot?.deals_by ?? ""} className={input}>
                  <option value="">—</option>
                  <option value="bd">BD</option>
                  <option value="cm">CM</option>
                  <option value="creator">Creator</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Pembayar ads</label>
                <select name="ads_payer" disabled={locked} defaultValue={slot?.ads_payer ?? ""} className={input}>
                  <option value="">—</option>
                  <option value="brand">Brand</option>
                  <option value="mea">MEA</option>
                  <option value="invoicing_mea">Invoicing MEA</option>
                  <option value="organik">Organik</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600">Catatan ads</label>
              <input
                name="ads_note" disabled={locked}
                defaultValue={slot?.ads_note ?? ""}
                placeholder="nominal / detail ads"
                className={input}
              />
            </div>

            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox" name="pk_ready" disabled={locked}
                  defaultChecked={slot?.pk_ready ?? false}
                />
                Product Knowledge Siap
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox" name="product_connected_tap" disabled={locked}
                  defaultChecked={slot?.product_connected_tap ?? false}
                />
                Produk connect TAP
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">Judul set produk</label>
                <input
                  name="product_set_title" disabled={locked}
                  defaultValue={slot?.product_set_title ?? ""}
                  className={input}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Fokus produk</label>
                <input
                  name="fokus_produk" disabled={locked}
                  defaultValue={slot?.fokus_produk ?? ""}
                  placeholder="produk fokus + catatan promo"
                  className={input}
                />
              </div>
            </div>
          </>
        )}

        {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            {!locked && (
              <button type="submit" disabled={pending} className={btn}>
                {pending ? "Menyimpan..." : isEdit ? "Simpan Perubahan" : "Buat Slot"}
              </button>
            )}
            <button type="button" onClick={onCancel} className={btnGhost}>
              Batal
            </button>
          </div>
          {isEdit && !locked && (
            <button type="button" onClick={onDelete} disabled={pending} className={btnDanger}>
              Hapus
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
