"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { updateCreatorProfile, type CreatorEditState } from "./actions";

/** Field editable oleh Creator Manager (commission_share TIDAK termasuk — read-only, CLAUDE.md #3). */
export interface EditableCreator {
  id: string;
  name: string;
  username: string | null;
  phone: string | null;
  rc_live: string | null;
  rc_video: string | null;
  rate_card: number | null;
  level: number | null;
  domisili: string | null;
  uid: string | null;
  status: string;
}

const STATUS_OPTIONS = ["prospek", "binding", "aktif", "nonaktif"] as const;

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

/**
 * Tombol Edit + modal untuk mengubah master data kreator satu baris.
 * Submit lewat server action updateCreatorProfile (audit_logs dicatat di server).
 */
export function CreatorEditButton({ creator }: { creator: EditableCreator }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CreatorEditState | null, FormData>(
    updateCreatorProfile,
    null
  );

  // Tutup modal otomatis setelah simpan sukses.
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  // Tutup dengan Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Edit
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">Edit Kreator</h2>
                <p className="text-xs text-slate-500">
                  {creator.name}
                  <span className="ml-1 font-mono text-[10px] text-slate-400">{creator.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>

            <form action={action} className="mt-4 grid grid-cols-2 gap-3">
              <input type="hidden" name="creator_id" value={creator.id} />

              <div className="col-span-2">
                <label className={labelCls} htmlFor={`name-${creator.id}`}>
                  Nama Creator
                </label>
                <input
                  id={`name-${creator.id}`}
                  name="name"
                  required
                  defaultValue={creator.name}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`username-${creator.id}`}>
                  Username
                </label>
                <input
                  id={`username-${creator.id}`}
                  name="username"
                  defaultValue={creator.username ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`phone-${creator.id}`}>
                  No HP
                </label>
                <input
                  id={`phone-${creator.id}`}
                  name="phone"
                  defaultValue={creator.phone ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`rc_live-${creator.id}`}>
                  RC Live
                </label>
                <input
                  id={`rc_live-${creator.id}`}
                  name="rc_live"
                  defaultValue={creator.rc_live ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`rc_video-${creator.id}`}>
                  RC Video
                </label>
                <input
                  id={`rc_video-${creator.id}`}
                  name="rc_video"
                  defaultValue={creator.rc_video ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`rate_card-${creator.id}`}>
                  Rate Card (Rp)
                </label>
                <input
                  id={`rate_card-${creator.id}`}
                  name="rate_card"
                  inputMode="numeric"
                  placeholder="mis. 1.500.000"
                  defaultValue={creator.rate_card ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`level-${creator.id}`}>
                  Level (1–6)
                </label>
                <input
                  id={`level-${creator.id}`}
                  name="level"
                  type="number"
                  min={1}
                  max={6}
                  defaultValue={creator.level ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`domisili-${creator.id}`}>
                  Domisili
                </label>
                <input
                  id={`domisili-${creator.id}`}
                  name="domisili"
                  defaultValue={creator.domisili ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`uid-${creator.id}`}>
                  UID
                </label>
                <input
                  id={`uid-${creator.id}`}
                  name="uid"
                  defaultValue={creator.uid ?? ""}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls} htmlFor={`status-${creator.id}`}>
                  Status
                </label>
                <select
                  id={`status-${creator.id}`}
                  name="status"
                  defaultValue={creator.status}
                  className={inputCls}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <p className="col-span-2 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                Sharing Komisi tidak bisa diedit di sini — sinkron dari platform (read-only). Turun =
                alert, bukan edit.
              </p>

              {state && !state.ok && (
                <p className="col-span-2 text-xs text-red-600">{state.error}</p>
              )}

              <div className="col-span-2 mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {pending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
