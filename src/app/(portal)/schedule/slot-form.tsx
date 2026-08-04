"use client";

import { useState, useTransition } from "react";
import type { LiveScheduleSlot, SlotStatus } from "@/lib/schedule/types";
import { createSlotAction, deleteSlotAction, updateSlotAction } from "./actions";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnGhost = "rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
const btnDanger = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

export interface DealOption {
  id: string;
  brand_name: string;
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
  deals,
  onDone,
  onCancel,
}: {
  slot: LiveScheduleSlot | null;
  creatorId: string;
  date: string;
  creators: RosterCreatorOption[];
  deals: DealOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<SlotStatus>(slot?.status === "done" ? "scheduled" : slot?.status ?? "scheduled");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isEdit = slot !== null;
  const locked = slot?.status === "done";

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
                  defaultValue={slot?.brand_name ?? ""}
                  placeholder="mis. MIX Brand / Organik"
                  className={input}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Link ke deal (opsional)</label>
                <select name="deal_id" disabled={locked} defaultValue={slot?.deal_id ?? ""} className={input}>
                  <option value="">— tidak ada —</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>{d.brand_name} ({d.id})</option>
                  ))}
                </select>
              </div>
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
