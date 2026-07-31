import { redirect } from "next/navigation";
import { requireMember, hasPermission, type Role } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_LABELS, TEAM_GROUP_LABELS, type TeamGroup } from "@/lib/tim/roles";
import {
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUS_LABELS,
  summarizeProposal,
  type ProposalKind,
} from "@/lib/tim/member-admin";
import { ProposeForm, type ProposableMember } from "./propose-form";

/**
 * M11 OD oversight — cross-team, read-only. OD tidak bisa memutasi data operasional apa pun.
 * Satu-satunya tulisan yang diizinkan adalah USULAN perubahan akun (member_change_requests):
 * baris usulan tidak berefek sampai Director menyetujuinya lewat m11.manage_accounts.
 * Akses halaman: od_viewer + Director (management juga boleh meninjau).
 */
export default async function OdOversightPage() {
  const member = await requireMember();
  if (!["od_viewer", "director", "head", "spv"].includes(member.role)) redirect("/dashboard");

  const canPropose = hasPermission("m11.propose_account_change", member.role);

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("od_oversight_v")
    .select(
      "cpm_id, cpm_name, report_count, creators_covered, complaint_count, complaint_weighted, repeat_complaint_creators"
    )
    .order("complaint_weighted", { ascending: false });

  const { data: teamRows } = await admin
    .from("team_members")
    .select("id, name, email, role, team_group, platform_segment, active")
    .order("active", { ascending: false })
    .order("name");

  const { data: proposalRows } = await admin
    .from("member_change_requests")
    .select("id, kind, target_label, payload, status, reason, requested_at, decision_note")
    .order("requested_at", { ascending: false })
    .limit(30);

  const team = (teamRows ?? []) as ProposableMember[];
  const proposals = (proposalRows ?? []) as {
    id: number;
    kind: ProposalKind;
    target_label: string;
    payload: Record<string, unknown>;
    status: string;
    reason: string;
    requested_at: string;
    decision_note: string | null;
  }[];

  return (
    <div className="space-y-6 p-2">
      <header>
        <h1 className="text-xl font-semibold">OD Oversight (read-only)</h1>
        <p className="text-sm text-slate-500">
          Kesehatan CPM lintas tim: coverage report (M2) + komplain kreator (M9, termasuk selesai).
          Tidak ada aksi mutasi — OD memantau, meng-export, dan mengusulkan perubahan akun yang
          diputuskan Director.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">CPM</th><th className="p-2">Report</th><th className="p-2">Kreator</th>
              <th className="p-2">Komplain</th><th className="p-2">Bobot severity</th><th className="p-2">Repeat</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).length === 0 ? (
              <tr><td className="p-3 text-slate-500" colSpan={6}>Belum ada data.</td></tr>
            ) : (rows ?? []).map((r) => (
              <tr key={r.cpm_id} className="border-t border-slate-100">
                <td className="p-2">{r.cpm_name}</td>
                <td className="p-2">{r.report_count}</td>
                <td className="p-2">{r.creators_covered}</td>
                <td className="p-2">{r.complaint_count}</td>
                <td className="p-2">{Number(r.complaint_weighted).toFixed(0)}</td>
                <td className="p-2">{r.repeat_complaint_creators > 0
                  ? <span className="text-red-600">{r.repeat_complaint_creators}</span>
                  : r.repeat_complaint_creators}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="text-base font-semibold">Direktori Tim</h2>
        <p className="mt-1 text-xs text-slate-500">
          Baca saja. Perubahan jabatan, penonaktifan, dan penghapusan dijalankan Director.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2">Nama</th>
                <th className="p-2">Email</th>
                <th className="p-2">Jabatan</th>
                <th className="p-2">Divisi</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {team.length === 0 ? (
                <tr><td className="p-3 text-slate-500" colSpan={5}>Belum ada anggota tim.</td></tr>
              ) : (
                team.map((m) => (
                  <tr
                    key={m.id}
                    className={`border-t border-slate-100 ${m.active ? "" : "bg-slate-50/60 text-slate-400"}`}
                  >
                    <td className="p-2 font-medium">{m.name}</td>
                    <td className="p-2 text-slate-600">{m.email}</td>
                    <td className="p-2">{ROLE_LABELS[m.role as Role] ?? m.role}</td>
                    <td className="p-2">
                      {TEAM_GROUP_LABELS[m.team_group as TeamGroup] ?? m.team_group}
                    </td>
                    <td className="p-2">{m.active ? "Aktif" : "Nonaktif"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {canPropose && <ProposeForm members={team} />}

      <section>
        <h2 className="text-base font-semibold">Status Usulan</h2>
        {proposals.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
            Belum ada usulan.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {PROPOSAL_KIND_LABELS[p.kind]}
                  </span>
                  <span
                    className={`text-xs font-medium ${
                      p.status === "pending"
                        ? "text-amber-700"
                        : p.status === "approved"
                          ? "text-green-700"
                          : "text-slate-500"
                    }`}
                  >
                    {PROPOSAL_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </div>
                <p className="mt-1.5 text-slate-800">
                  {summarizeProposal(p.kind, p.target_label, p.payload)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Alasan: {p.reason}</p>
                {p.decision_note && (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Catatan Director: {p.decision_note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
