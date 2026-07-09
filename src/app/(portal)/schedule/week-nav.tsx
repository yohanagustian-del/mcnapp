"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { copyWeekAction } from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/** Week navigation + "Salin dari minggu lalu" (only rendered when hasPermission schedule.edit). */
export function WeekNav({
  weekStart,
  prevWeekStart,
  nextWeekStart,
  rangeLabel,
  canEdit,
}: {
  weekStart: string;
  prevWeekStart: string;
  nextWeekStart: string;
  rangeLabel: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onCopy() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("source_week_start", prevWeekStart);
      fd.set("target_week_start", weekStart);
      const res = await copyWeekAction(fd);
      if (res.ok) {
        setSuccess(`${res.copiedCount} slot disalin dari minggu lalu.`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-3 text-sm">
        <Link href={`/schedule?week=${prevWeekStart}`} className="text-slate-600 underline underline-offset-2">
          ‹ Minggu sebelumnya
        </Link>
        <span className="font-medium text-slate-800">{rangeLabel}</span>
        <Link href={`/schedule?week=${nextWeekStart}`} className="text-slate-600 underline underline-offset-2">
          Minggu berikutnya ›
        </Link>
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={onCopy} disabled={pending}
            className={`${btnSmall} bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50`}
          >
            {pending ? "Menyalin..." : "Salin dari minggu lalu"}
          </button>
          {error && <span className="text-xs text-red-700">{error}</span>}
          {success && <span className="text-xs text-green-700">{success}</span>}
        </div>
      )}
    </div>
  );
}
