"use client";

import { useMemo, useState, useTransition } from "react";
import {
  PAGE_SIZE_10,
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
} from "@/components/table-controls";
import { formatOkrTarget } from "@/lib/utils/format";
import { deleteOkrObjective, deleteOkrSettingKr, updateOkrSetting } from "./actions";
import {
  objectiveChoicesFor,
  OkrSettingFields,
  toOkrSettingFormData,
  type ObjectiveOption,
  type OkrSettingFieldValue,
} from "./okr-setting-fields";

/** Satu baris tabel = satu Key Result. `krId` null = Objective yang belum punya KR. */
export interface OkrSettingRow {
  krId: number | null;
  objectiveId: number;
  okrName: string;
  objective: string;
  keyResult: string | null;
  target: number | null;
  targetUnit: string | null;
}

const btnSm = "rounded-md px-2 py-1 text-xs font-medium";

/**
 * Tabel OKR Setting: search nama OKR (realtime), header asc/desc, paginasi 10
 * baris, dan edit/hapus per baris.
 *
 * Barisnya sengaja RATA (nama OKR & Objective diulang tiap KR) — bukan digabung
 * pakai rowSpan — karena begitu tabel bisa diurutkan dan dipaginasi, baris satu
 * Objective tidak lagi dijamin bersebelahan.
 *
 * Mengedit baris memindahkan KR itu ke pasangan (nama OKR, Objective) yang baru;
 * KR lain yang menumpang Objective yang sama tidak ikut berubah — aturan itu ada
 * di server action, komponen ini hanya mengirim isian form.
 */
export function OkrSettingTable({
  rows,
  objectives,
}: {
  rows: OkrSettingRow[];
  objectives: ObjectiveOption[];
}) {
  const [editingKrId, setEditingKrId] = useState<number | null>(null);
  const [draft, setDraft] = useState<OkrSettingFieldValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const controls = useTableControls<OkrSettingRow>({
    rows,
    // "Hot search": mengetik langsung menyaring, tanpa query ulang ke server.
    searchText: (r) => r.okrName,
    sort: useMemo(
      () => ({
        columns: {
          okr_name:   { value: (r: OkrSettingRow) => r.okrName },
          objective:  { value: (r: OkrSettingRow) => r.objective },
          key_result: { value: (r: OkrSettingRow) => r.keyResult },
          target:     { value: (r: OkrSettingRow) => r.target, firstDir: "desc" as const },
        },
      }),
      []
    ),
    pageSizes: PAGE_SIZE_10,
    itemLabel: "Key Result",
  });

  function startEdit(row: OkrSettingRow) {
    setError(null);
    setEditingKrId(row.krId);
    setDraft({
      okrName: row.okrName,
      objectiveId: String(row.objectiveId),
      objectiveNew: row.objective,
      keyResult: row.keyResult ?? "",
      target: row.target === null ? "" : String(row.target),
      targetUnit: (row.targetUnit as OkrSettingFieldValue["targetUnit"]) ?? "angka",
    });
  }

  function cancelEdit() {
    setEditingKrId(null);
    setDraft(null);
    setError(null);
  }

  function submitEdit(krId: number) {
    if (!draft) return;
    const choices = objectiveChoicesFor(objectives, draft.okrName);
    const formData = toOkrSettingFormData(draft, choices);
    formData.set("kr_id", String(krId));

    setError(null);
    startTransition(async () => {
      const res = await updateOkrSetting(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      cancelEdit();
    });
  }

  function removeRow(row: OkrSettingRow) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      let res;
      if (row.krId === null) {
        formData.set("objective_id", String(row.objectiveId));
        res = await deleteOkrObjective(formData);
      } else {
        formData.set("kr_id", String(row.krId));
        res = await deleteOkrSettingKr(formData);
      }
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="mt-4 space-y-2">
      <TableFilterBar controls={controls} searchPlaceholder="Cari nama OKR…" />
      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="okr_name">Nama OKR</SortableTh>
              <SortableTh controls={controls} sortKey="objective">Objective</SortableTh>
              <SortableTh controls={controls} sortKey="key_result">Key Result</SortableTh>
              <SortableTh controls={controls} sortKey="target">Target (3 bulan)</SortableTh>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((row) => {
              const isEditing = row.krId !== null && row.krId === editingKrId;
              if (isEditing && draft) {
                return (
                  <tr key={`edit-${row.krId}`} className="bg-slate-50">
                    <td colSpan={5} className="px-4 py-3">
                      <p className="text-xs font-medium text-slate-600">Edit Key Result</p>
                      <div className="mt-2 grid gap-4 lg:grid-cols-2">
                        <OkrSettingFields
                          value={draft}
                          onChange={setDraft}
                          objectives={objectives}
                          idPrefix={`edit-${row.krId}`}
                        />
                        <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => submitEdit(row.krId as number)}
                            disabled={pending}
                            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                          >
                            {pending ? "Menyimpan…" : "Simpan perubahan"}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={pending}
                            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-white disabled:opacity-50"
                          >
                            Batal
                          </button>
                          <span className="text-xs text-slate-400">
                            Mengganti Objective memindahkan Key Result ini saja; KR lain pada Objective lama tetap.
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={row.krId === null ? `obj-${row.objectiveId}` : `kr-${row.krId}`}>
                  <td className="px-4 py-2 font-medium align-top">{row.okrName}</td>
                  <td className="px-4 py-2 align-top">{row.objective}</td>
                  <td className="px-4 py-2 align-top">
                    {row.keyResult ?? (
                      <span className="text-slate-400">Belum ada Key Result untuk Objective ini.</span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top whitespace-nowrap font-semibold">
                    {row.krId === null ? "—" : formatOkrTarget(row.target, row.targetUnit ?? "angka")}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="flex gap-2">
                      {row.krId !== null && (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          disabled={pending}
                          className={`${btnSm} bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50`}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeRow(row)}
                        disabled={pending}
                        className={`${btnSm} bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50`}
                        title={row.krId === null ? "Hapus Objective yang sudah tidak punya KR" : "Hapus Key Result ini"}
                      >
                        {row.krId === null ? "Hapus Objective" : "Hapus"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {controls.total === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  {controls.filterActive
                    ? "Tidak ada nama OKR yang cocok dengan pencarian."
                    : "Belum ada OKR tersimpan. Isi form di atas untuk memulai."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination controls={controls} />
      </div>
    </div>
  );
}
