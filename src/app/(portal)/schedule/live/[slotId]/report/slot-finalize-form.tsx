"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { finalizeSlotReport } from "../actions";

/**
 * Finalisasi report live slot (human-in-the-loop): tim menulis narasi, report
 * dikunci, dan kreator bisa membacanya di portal. Narasi ditulis MANUSIA —
 * angka & catatan performa di report sudah deterministik (0 token AI).
 */
export function SlotFinalizeForm({ reportId, insightDraft }: { reportId: number; insightDraft: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(insightDraft ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    setError(null);
    const fd = new FormData();
    fd.set("report_id", String(reportId));
    fd.set("insight_final", text);
    startTransition(async () => {
      const res = await finalizeSlotReport(fd);
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-4 print:hidden">
      <label className="block text-sm font-medium" htmlFor="slot-insight">
        Catatan tim untuk kreator (opsional, ditulis manusia)
      </label>
      <textarea
        id="slot-insight" rows={5} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Mis. arahan untuk live berikutnya — jam mulai, urutan produk, durasi."
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" onClick={onSubmit} disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "Menyimpan…" : "Finalkan Report"}
      </button>
      <p className="text-xs text-slate-400">
        Setelah final, report muncul di portal kreator dan tidak bisa diubah lagi (hanya angkanya yang
        bisa disegarkan kalau ada sesi baru).
      </p>
    </div>
  );
}
