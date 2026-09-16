"use client";

import { useTransition, useState } from "react";
import { submitProjectFeedback } from "@/app/portal/projects/feedback-actions";

export interface ProjectFeedbackDefaults {
  ratingOverall: number | null;
  ratingMateri: number | null;
  ratingMentor: number | null;
  ratingOrganisasi: number | null;
  nps: number | null;
  wouldJoinAgain: boolean | null;
  bestPart: string | null;
  improvement: string | null;
}


/** Form feedback project (§3.8, R31/R32) — 1 form, boleh dikirim ulang sampai tutup. */
export function ProjectFeedbackForm({
  projectId, defaults, closesAt,
}: { projectId: number; defaults: ProjectFeedbackDefaults; closesAt: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-medium">Feedback</h2>
      {closesAt && <p className="text-xs text-slate-400">Terbuka sampai {new Date(closesAt).toLocaleDateString("id-ID")}</p>}
      {done && <p className="mt-2 text-xs text-green-700">Feedback tersimpan — terima kasih! Bisa diedit lagi selama jendela masih terbuka.</p>}
      <form
        action={(fd) => {
          setError(null);
          startTransition(async () => {
            try {
              await submitProjectFeedback(fd);
              setDone(true);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Gagal mengirim feedback");
            }
          });
        }}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="project_id" value={projectId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-600">
            Keseluruhan (1-5)
            <input type="number" min={1} max={5} required name="rating_overall"
              defaultValue={defaults.ratingOverall ?? undefined}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Materi (1-5)
            <input type="number" min={1} max={5} required name="rating_materi"
              defaultValue={defaults.ratingMateri ?? undefined}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Mentor (1-5)
            <input type="number" min={1} max={5} required name="rating_mentor"
              defaultValue={defaults.ratingMentor ?? undefined}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">
            Penyelenggaraan (1-5)
            <input type="number" min={1} max={5} required name="rating_organisasi"
              defaultValue={defaults.ratingOrganisasi ?? undefined}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <label className="block text-xs text-slate-600">
          Seberapa besar kemungkinan kamu merekomendasikan project ini ke kreator lain? (NPS 0-10)
          <input type="number" min={0} max={10} required name="nps" defaultValue={defaults.nps ?? undefined}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="would_join_again" defaultChecked={defaults.wouldJoinAgain ?? false} />
          Mau ikut project seperti ini lagi
        </label>
        <label className="block text-xs text-slate-600">
          Bagian paling bermanfaat
          <textarea name="best_part" rows={2} defaultValue={defaults.bestPart ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs text-slate-600">
          Yang perlu diperbaiki
          <textarea name="improvement" rows={2} defaultValue={defaults.improvement ?? ""}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {defaults.ratingOverall !== null ? "Perbarui Feedback" : "Kirim Feedback"}
        </button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </form>
    </div>
  );
}
