"use client";

import { useActionState, useEffect, useState } from "react";
import { BULK_LIMIT } from "@/lib/m10/product-keys";
import { bulkDeleteProducts, bulkUpdateProducts, type ProductBulkState } from "./actions";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

/**
 * Baris aksi untuk produk yang dicentang di tabel Produk TAP.
 *
 * Muncul hanya saat ada yang terpilih, dan sengaja menempel di atas tabel (bukan
 * modal melayang) supaya jumlah terpilih selalu terlihat sebelum tombol ditekan.
 *
 * Edit massal dibatasi Shop ID & Shop Name — dua kolom yang memang sering salah
 * serempak per campaign. Hapus massal minta konfirmasi ketik "HAPUS", dan server
 * meminta konfirmasi yang sama sekali lagi.
 */
export function BulkActionBar({
  selectedKeys,
  canEdit,
  canDelete,
  onCleared,
}: {
  selectedKeys: string[];
  canEdit: boolean;
  canDelete: boolean;
  /**
   * Dipanggil setelah aksi berhasil (dengan pesan hasil) atau saat user membatalkan
   * pilihan. Baris aksi ini ikut hilang bersama pilihannya, jadi pesan suksesnya
   * dititipkan ke tabel — kalau tidak, hasil "10 produk dihapus" tak pernah terbaca.
   */
  onCleared: (message?: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);

  const [editState, editAction, editPending] = useActionState<ProductBulkState, FormData>(
    bulkUpdateProducts,
    null
  );
  const [deleteState, deleteAction, deletePending] = useActionState<ProductBulkState, FormData>(
    bulkDeleteProducts,
    null
  );

  const done = (editState?.ok ? editState : null) ?? (deleteState?.ok ? deleteState : null);
  useEffect(() => {
    if (!done) return;
    setMode(null);
    onCleared(done.message);
    // onCleared berasal dari komponen induk dan stabil per render tabel; yang
    // menentukan efek ini jalan adalah hasil aksi, bukan identitas fungsinya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const count = selectedKeys.length;
  const overLimit = count > BULK_LIMIT;
  const keysField = JSON.stringify(selectedKeys);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm font-medium text-slate-700">{count} produk terpilih</span>

      {canEdit && (
        <button
          type="button"
          onClick={() => setMode(mode === "edit" ? null : "edit")}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        >
          Edit Shop (massal)
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={() => setMode(mode === "delete" ? null : "delete")}
          className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          Hapus terpilih
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setMode(null);
          onCleared();
        }}
        className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
      >
        Batal pilih
      </button>

      {overLimit && (
        <span className="text-xs text-red-600" role="alert">
          Maksimal {BULK_LIMIT} produk sekali proses.
        </span>
      )}
      {editState && !editState.ok && (
        <span className="text-xs text-red-600" role="alert">
          {editState.message}
        </span>
      )}
      {deleteState && !deleteState.ok && (
        <span className="text-xs text-red-600" role="alert">
          {deleteState.message}
        </span>
      )}

      {mode === "edit" && (
        <form action={editAction} className="mt-2 w-full rounded-md border border-slate-200 bg-white p-3">
          <input type="hidden" name="keys" value={keysField} />
          <p className="text-xs text-slate-500">
            Nilai yang diisi akan diterapkan ke <strong>{count}</strong> produk terpilih. Kolom yang
            dibiarkan kosong tidak diubah.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">
              Shop ID (angka)
              <input name="shop_id" inputMode="numeric" className={inputCls} placeholder="7495123456789" />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Shop Name
              <input name="shop_name" className={inputCls} placeholder="Skintific Official Store" />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={editPending || overLimit}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {editPending ? "Menyimpan…" : `Terapkan ke ${count} produk`}
            </button>
          </div>
        </form>
      )}

      {mode === "delete" && (
        <form action={deleteAction} className="mt-2 w-full rounded-md border border-red-200 bg-red-50 p-3">
          <input type="hidden" name="keys" value={keysField} />
          <p className="text-sm text-red-800">
            Hapus <strong>{count}</strong> produk terpilih dari katalog? Isi lengkap baris yang
            dihapus tetap tercatat di audit log, tapi barisnya hilang dari tabel ini.
          </p>
          <label className="mt-2 block text-xs font-medium text-red-800">
            Ketik HAPUS untuk konfirmasi
            <input name="confirm" autoComplete="off" className={inputCls} placeholder="HAPUS" />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={deletePending || overLimit}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deletePending ? "Menghapus…" : `Hapus ${count} produk`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
