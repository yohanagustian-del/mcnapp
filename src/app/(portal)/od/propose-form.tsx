"use client";

import { useActionState, useState } from "react";
import { MemberFields, type MemberFieldValues } from "@/components/member-fields";
import { PROPOSAL_KINDS, PROPOSAL_KIND_LABELS, type ProposalKind } from "@/lib/tim/member-admin";
import { proposeMemberChange, type ProposalActionState } from "../tim/member-actions";

export interface ProposableMember extends MemberFieldValues {
  id: string;
  name: string;
  email: string;
}

const labelCls = "block text-xs font-medium text-slate-600";
const inputCls =
  "mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

/**
 * Form usulan perubahan akun untuk OD. OD tidak punya jalur tulis apa pun ke team_members —
 * form ini hanya menitipkan usulan ke antrean; Director yang mengeksekusi.
 */
export function ProposeForm({ members }: { members: ProposableMember[] }) {
  const [kind, setKind] = useState<ProposalKind>("update");
  const [targetId, setTargetId] = useState("");
  const [state, action, pending] = useActionState<ProposalActionState, FormData>(
    proposeMemberChange,
    null
  );

  const target = members.find((m) => m.id === targetId);
  const needsTarget = kind !== "create";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold">Ajukan Perubahan Akun</h2>
      <p className="mt-1 text-xs text-slate-500">
        Usulan Anda tidak mengubah apa pun sampai Director menyetujuinya di halaman Tim.
      </p>

      <form action={action} className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="kind">
            Jenis usulan
          </label>
          <select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ProposalKind)}
            className={inputCls}
          >
            {PROPOSAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {PROPOSAL_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        {needsTarget && (
          <div>
            <label className={labelCls} htmlFor="member_id">
              Anggota tim
            </label>
            <select
              id="member_id"
              name="member_id"
              required
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className={inputCls}
            >
              <option value="" disabled>
                Pilih anggota…
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.email}
                </option>
              ))}
            </select>
          </div>
        )}

        {kind === "create" && <MemberFields idPrefix="propose-create" mode="create" />}

        {kind === "update" &&
          (target ? (
            // key = id target → field ikut tersegar saat anggota lain dipilih.
            <div key={target.id} className="col-span-2 grid grid-cols-2 gap-3">
              <MemberFields idPrefix="propose-update" mode="propose-update" values={target} />
            </div>
          ) : (
            <p className="col-span-2 text-xs text-slate-400">
              Pilih anggota tim dulu untuk mengisi usulan perubahannya.
            </p>
          ))}

        <div className="col-span-2">
          <label className={labelCls} htmlFor="reason">
            Alasan (minimal 10 karakter — jadi dasar keputusan Director)
          </label>
          <textarea id="reason" name="reason" required minLength={10} rows={3} className={inputCls} />
        </div>

        {state && !state.ok && <p className="col-span-2 text-xs text-red-600">{state.error}</p>}
        {state?.ok && <p className="col-span-2 text-xs text-green-700">{state.message}</p>}

        <div className="col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {pending ? "Mengirim…" : "Kirim Usulan"}
          </button>
        </div>
      </form>
    </section>
  );
}
