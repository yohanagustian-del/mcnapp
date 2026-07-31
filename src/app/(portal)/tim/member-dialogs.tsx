"use client";

import { useActionState, useEffect, useState } from "react";
import { Modal, MemberFields, inputCls, labelCls } from "@/components/member-fields";
import {
  createMember,
  updateMember,
  deleteMember,
  deactivateMember,
  type MemberActionState,
} from "./member-actions";

export interface ManagedMember {
  id: string;
  name: string;
  email: string;
  role: string;
  team_group: string;
  platform_segment: string | null;
  active: boolean;
}

const primaryBtn =
  "rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const ghostBtn = "rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100";
const dangerBtn =
  "rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50";

/** Password sementara ditampilkan sekali; tidak tersimpan di DB maupun audit_logs. */
function TempPasswordPanel({ password, email }: { password: string; email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-medium text-amber-900">
        Password sementara — ditampilkan sekali ini saja
      </p>
      <p className="mt-1 break-all font-mono text-base text-amber-950">{password}</p>
      <p className="mt-2 text-[11px] text-amber-800">
        Kirim ke <strong>{email}</strong> lewat kanal pribadi. Sistem tidak menyimpannya, jadi kalau
        hilang password harus di-reset ulang. User wajib menggantinya saat login pertama sebelum bisa
        membuka portal.
      </p>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(password);
          setCopied(true);
        }}
        className="mt-2 rounded bg-amber-200 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-300"
      >
        {copied ? "Tersalin" : "Salin password"}
      </button>
    </div>
  );
}

/** Tombol + modal "Tambah Anggota" (Director). */
export function AddMemberButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<MemberActionState, FormData>(createMember, null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primaryBtn}>
        + Tambah Anggota
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Tambah Anggota Tim"
        subtitle="Akun login dibuat langsung dengan password sementara."
      >
        {state?.ok && state.tempPassword ? (
          <div>
            <p className="mt-4 text-sm text-slate-700">{state.message}</p>
            <TempPasswordPanel
              password={state.tempPassword}
              email={state.tempPasswordEmail ?? ""}
            />
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className={primaryBtn}>
                Selesai
              </button>
            </div>
          </div>
        ) : (
          <form action={action} className="mt-4 grid grid-cols-2 gap-3">
            <MemberFields idPrefix="add" mode="create" />
            {state && !state.ok && (
              <p className="col-span-2 text-xs text-red-600">{state.error}</p>
            )}
            <div className="col-span-2 mt-1 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
                Batal
              </button>
              <button type="submit" disabled={pending} className={primaryBtn}>
                {pending ? "Membuat…" : "Buat Akun"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

/** Tombol + modal ganti jabatan / data anggota (Director). */
export function EditMemberButton({ member }: { member: ManagedMember }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<MemberActionState, FormData>(updateMember, null);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
      >
        Edit
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit Anggota Tim"
        subtitle={member.email}
      >
        <form action={action} className="mt-4 grid grid-cols-2 gap-3">
          <input type="hidden" name="member_id" value={member.id} />
          <MemberFields idPrefix={`edit-${member.id}`} mode="edit" values={member} />
          <p className="col-span-2 rounded-md bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Email tidak bisa diubah — itu identitas akun login. Kalau emailnya memang berganti,
            nonaktifkan akun ini lalu buat akun baru.
          </p>
          {state && !state.ok && <p className="col-span-2 text-xs text-red-600">{state.error}</p>}
          <div className="col-span-2 mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
              Batal
            </button>
            <button type="submit" disabled={pending} className={primaryBtn}>
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/**
 * Tombol + modal hapus permanen (Director). Server melakukan pemeriksaan di muka dan
 * menolak dengan menyebut data apa yang menghalangi; modal ini menawarkan
 * "Nonaktifkan" sebagai jalan keluar tanpa harus pindah dialog.
 */
export function DeleteMemberButton({ member }: { member: ManagedMember }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [delState, delAction, delPending] = useActionState<MemberActionState, FormData>(
    deleteMember,
    null
  );
  const [offState, offAction, offPending] = useActionState<MemberActionState, FormData>(
    deactivateMember,
    null
  );

  useEffect(() => {
    if (delState?.ok || offState?.ok) setOpen(false);
  }, [delState, offState]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirmText("");
          setOpen(true);
        }}
        className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        Hapus
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Hapus Permanen"
        subtitle={`${member.name} — ${member.email}`}
      >
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-medium">Tindakan ini tidak bisa dibatalkan.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Baris anggota tim dan akun login-nya benar-benar dihapus.</li>
            <li>
              Jejak kerjanya (report, deal, upload, jadwal) <strong>tetap ada</strong>, tapi kolom
              pelakunya menjadi kosong.
            </li>
            <li>Log page-view (adopsi sistem) miliknya ikut terhapus.</li>
            <li>Riwayat audit tetap utuh — identitasnya disimpan sebagai catatan teks.</li>
          </ul>
          <p className="mt-2">
            Kalau ia masih terhubung ke catatan yang wajib punya pelaku (upload data platform, slot
            jadwal live, man power Special Project), penghapusan akan ditolak dan Anda diarahkan
            menonaktifkan saja.
          </p>
        </div>

        <form action={delAction} className="mt-4">
          <input type="hidden" name="member_id" value={member.id} />
          <label className={labelCls} htmlFor={`confirm-${member.id}`}>
            Ketik <span className="font-mono font-semibold">HAPUS</span> untuk mengonfirmasi
          </label>
          <input
            id={`confirm-${member.id}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className={inputCls}
            autoComplete="off"
          />
          {delState && !delState.ok && (
            <p className="mt-2 text-xs text-red-600">{delState.error}</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
              Batal
            </button>
            <button
              type="submit"
              disabled={delPending || confirmText.trim().toUpperCase() !== "HAPUS"}
              className={dangerBtn}
            >
              {delPending ? "Menghapus…" : "Hapus Permanen"}
            </button>
          </div>
        </form>

        <form action={offAction} className="mt-4 border-t border-slate-200 pt-3">
          <input type="hidden" name="member_id" value={member.id} />
          <p className="text-xs text-slate-500">
            Alternatif yang aman: akun tidak bisa login lagi, seluruh riwayat utuh, dan bisa
            diaktifkan kembali kapan saja.
          </p>
          {offState && !offState.ok && (
            <p className="mt-2 text-xs text-red-600">{offState.error}</p>
          )}
          <button
            type="submit"
            disabled={offPending || !member.active}
            className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {offPending
              ? "Menonaktifkan…"
              : member.active
                ? "Nonaktifkan saja"
                : "Sudah nonaktif"}
          </button>
        </form>
      </Modal>
    </>
  );
}
