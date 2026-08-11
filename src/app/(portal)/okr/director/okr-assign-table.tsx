"use client";

import { useMemo, useState, useTransition } from "react";
import {
  PAGE_SIZE_10,
  SortableTh,
  TableFilterBar,
  TablePagination,
  useTableControls,
} from "@/components/table-controls";
import { formatPeriodRange, validateAssignPeriod } from "@/lib/m3/okr-setting";
import { assignOkrToMembers, unassignOkr, unassignOkrFromMembers } from "./actions";

/** OKR yang sudah dipegang satu anggota (untuk badge + tombol batalkan). */
export interface MemberOkr {
  assignmentId: number;
  okrName: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Nama OKR ini sudah tidak punya Objective di OKR Setting (naskahnya dihapus). */
  orphan: boolean;
}

export interface AssignMemberRow {
  memberId: string;
  name: string;
  role: string;
  teamGroup: string | null;
  active: boolean;
  okrs: MemberOkr[];
}

/**
 * Section "Assign OKR": tugaskan (atau lepas) satu nama OKR ke banyak anggota tim
 * sekaligus dengan mencentang namanya, plus periode berlaku, header asc/desc, dan
 * paginasi 10 baris.
 *
 * Centang disimpan per memberId di state, jadi pilihan TIDAK hilang saat user
 * pindah halaman atau mengurutkan ulang — footer menampilkan berapa yang terpilih
 * di luar halaman aktif supaya tidak ada penugasan yang "diam-diam" ikut terkirim.
 *
 * Assign butuh periode (tanggal awal & akhir); unassign bulk tidak — satu klik
 * melepas nama OKR itu dari anggota terpilih untuk semua periodenya, biar hasilnya
 * tidak bergantung pada isi field tanggal. Untuk melepas satu periode saja, pakai
 * tombol × di badge OKR anggota.
 */
export function OkrAssignTable({
  members,
  okrNames,
}: {
  members: AssignMemberRow[];
  okrNames: string[];
}) {
  const [okrName, setOkrName] = useState(okrNames[0] ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const controls = useTableControls<AssignMemberRow>({
    rows: members,
    searchText: (r) => `${r.name} ${r.role} ${r.teamGroup ?? ""}`,
    sort: useMemo(
      () => ({
        columns: {
          name:  { value: (r: AssignMemberRow) => r.name },
          role:  { value: (r: AssignMemberRow) => r.role },
          group: { value: (r: AssignMemberRow) => r.teamGroup },
          okr:   { value: (r: AssignMemberRow) => r.okrs.length, firstDir: "desc" as const },
        },
        initial: { key: "name", dir: "asc" as const },
      }),
      []
    ),
    pageSizes: PAGE_SIZE_10,
    itemLabel: "anggota",
  });

  const selectedSet = new Set(selected);
  const pageIds = controls.visibleRows.map((r) => r.memberId);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));
  const selectedOffPage = selected.filter((id) => !pageIds.includes(id)).length;

  /**
   * Anggota terpilih yang SUDAH punya OKR ini untuk periode yang sedang diisi —
   * dilewati server, ditandai di sini supaya jumlah di tombol tidak menyesatkan.
   */
  const alreadyAssigned = useMemo(
    () =>
      members.filter(
        (m) =>
          selectedSet.has(m.memberId) &&
          m.okrs.some(
            (o) =>
              o.okrName === okrName &&
              o.periodStart === (periodStart || null) &&
              o.periodEnd === (periodEnd || null)
          )
      ).length,
    // selectedSet diturunkan dari selected pada setiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, selected, okrName, periodStart, periodEnd]
  );

  /** Anggota terpilih yang memegang OKR ini (periode apa pun) — target unassign bulk. */
  const holdersSelected = useMemo(
    () =>
      members.filter(
        (m) => selectedSet.has(m.memberId) && m.okrs.some((o) => o.okrName === okrName)
      ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, selected, okrName]
  );

  const periodError = validateAssignPeriod(periodStart, periodEnd);

  function toggleMember(id: string) {
    setSaved(null);
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function togglePage() {
    setSaved(null);
    setSelected((prev) =>
      allPageSelected
        ? prev.filter((id) => !pageIds.includes(id))
        : [...new Set([...prev, ...pageIds])]
    );
  }

  function submitAssign() {
    if (periodError) {
      setError(periodError);
      return;
    }
    const formData = new FormData();
    formData.set("okr_name", okrName);
    formData.set("period_start", periodStart);
    formData.set("period_end", periodEnd);
    for (const id of selected) formData.append("member_ids", id);

    const assignedCount = selected.length - alreadyAssigned;
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await assignOkrToMembers(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(
        `"${okrName}" ter-assign ke ${assignedCount} anggota tim untuk ${formatPeriodRange(periodStart, periodEnd)}.`
      );
      setSelected([]);
    });
  }

  function submitUnassign() {
    const formData = new FormData();
    formData.set("okr_name", okrName);
    for (const id of selected) formData.append("member_ids", id);

    const removedFrom = holdersSelected;
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const res = await unassignOkrFromMembers(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(`"${okrName}" dilepas dari ${removedFrom} anggota tim (semua periode).`);
      setSelected([]);
    });
  }

  function removeAssignment(assignmentId: number) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("assignment_id", String(assignmentId));
      const res = await unassignOkr(formData);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="mt-3 space-y-2">
      {/* Baris aksi: nama OKR + periode, lalu assign/unassign massal ke yang dicentang */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600" htmlFor="assign-okr-name">
              Nama OKR
            </label>
            <select
              id="assign-okr-name"
              value={okrName}
              onChange={(e) => { setOkrName(e.target.value); setSaved(null); }}
              disabled={okrNames.length === 0}
              className="mt-1 w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            >
              {okrNames.length === 0 && <option value="">— belum ada OKR —</option>}
              {okrNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600" htmlFor="assign-period-start">
              Tanggal awal periode
            </label>
            <input
              id="assign-period-start"
              type="date"
              value={periodStart}
              onChange={(e) => { setPeriodStart(e.target.value); setSaved(null); }}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600" htmlFor="assign-period-end">
              Tanggal akhir periode
            </label>
            <input
              id="assign-period-end"
              type="date"
              value={periodEnd}
              min={periodStart || undefined}
              onChange={(e) => { setPeriodEnd(e.target.value); setSaved(null); }}
              className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submitAssign}
            disabled={pending || !okrName || selected.length === 0 || periodError !== null}
            title={periodError ?? undefined}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Menyimpan…" : `Assign ke ${selected.length} tim terpilih`}
          </button>
          <button
            type="button"
            onClick={submitUnassign}
            disabled={pending || !okrName || selected.length === 0}
            className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {pending ? "Menyimpan…" : `Unassign dari ${selected.length} tim terpilih`}
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected([])}
              disabled={pending}
              className="rounded-md px-2 py-2 text-sm text-slate-500 underline underline-offset-2 hover:text-slate-800"
            >
              Bersihkan centang
            </button>
          )}
        </div>

        <p className="mt-2 text-xs text-slate-400">
          {okrNames.length === 0
            ? "Isi OKR Setting dulu — daftar nama OKR diambil dari sana."
            : "Centang nama tim di tabel, lalu Assign (butuh periode) atau Unassign. Periode berbeda = penugasan baru, jadi OKR yang sama bisa dipakai lagi untuk quartal berikutnya."}
          {" "}Unassign melepas semua periode nama OKR ini dari anggota terpilih; untuk satu periode saja pakai tombol × di badge.
          {alreadyAssigned > 0 && ` ${alreadyAssigned} dari yang dicentang sudah punya OKR ini untuk periode tersebut (akan dilewati).`}
        </p>
        {periodError && selected.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">{periodError} (hanya wajib untuk Assign)</p>
        )}
        {saved && <p className="mt-1 text-xs text-green-700">{saved}</p>}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>

      <TableFilterBar controls={controls} searchPlaceholder="Cari nama / role tim…" />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePage}
                  aria-label="Centang semua anggota di halaman ini"
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <SortableTh controls={controls} sortKey="name">Nama Tim</SortableTh>
              <SortableTh controls={controls} sortKey="role">Role</SortableTh>
              <SortableTh controls={controls} sortKey="group">Grup</SortableTh>
              <SortableTh controls={controls} sortKey="okr">OKR yang dipegang</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((m) => (
              <tr key={m.memberId} className={selectedSet.has(m.memberId) ? "bg-slate-50" : ""}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(m.memberId)}
                    onChange={() => toggleMember(m.memberId)}
                    aria-label={`Centang ${m.name}`}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </td>
                <td className="px-4 py-2 font-medium">
                  {m.name}
                  {!m.active && <span className="ml-2 text-xs text-slate-400">(nonaktif)</span>}
                </td>
                <td className="px-4 py-2">{m.role}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{m.teamGroup ?? "—"}</td>
                <td className="px-4 py-2">
                  {m.okrs.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {m.okrs.map((o) => (
                        <span
                          key={o.assignmentId}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                            o.orphan ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                          }`}
                          title={o.orphan ? "Naskah OKR ini sudah tidak ada di OKR Setting" : undefined}
                        >
                          {o.okrName}
                          {o.orphan && " ⚠"}
                          <span className="font-normal text-slate-500">
                            ({formatPeriodRange(o.periodStart, o.periodEnd)})
                          </span>
                          <button
                            type="button"
                            onClick={() => removeAssignment(o.assignmentId)}
                            disabled={pending}
                            aria-label={`Batalkan ${o.okrName} dari ${m.name}`}
                            className="text-slate-400 hover:text-red-700 disabled:opacity-50"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {controls.total === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  {controls.filterActive ? "Tidak ada anggota tim yang cocok." : "Belum ada anggota tim."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <TablePagination controls={controls} />
      </div>

      {selectedOffPage > 0 && (
        <p className="text-xs text-slate-500">
          {selected.length} anggota tercentang, {selectedOffPage} di antaranya ada di halaman lain —
          semuanya ikut saat Assign ditekan.
        </p>
      )}
    </div>
  );
}
