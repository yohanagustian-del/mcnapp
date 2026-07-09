"use client";

import { useActionState } from "react";
import {
  replyToComplaint,
  updateComplaintStatus,
  type ComplaintActionState,
} from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/** Balas komplain (append-only complaint_replies) — inline per-row form. */
export function ComplaintReplyForm({ complaintId }: { complaintId: number }) {
  const [state, action, pending] = useActionState<ComplaintActionState | null, FormData>(
    replyToComplaint,
    null
  );

  return (
    <form action={action} className="mt-2 flex items-start gap-2">
      <input type="hidden" name="complaint_id" value={complaintId} />
      <textarea
        name="body"
        required
        rows={2}
        placeholder="Tulis balasan…"
        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className={`${btnSmall} bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50`}
      >
        {pending ? "Mengirim…" : "Balas"}
      </button>
      {state && !state.ok && (
        <p className="mt-1 basis-full text-xs text-red-600">{state.error}</p>
      )}
    </form>
  );
}

/** Ubah status komplain (dalam-penyelesaian / selesai) — selesai set closed_at/closed_by. */
export function ComplaintStatusForm({
  complaintId,
  status,
}: {
  complaintId: number;
  status: string;
}) {
  const [state, action, pending] = useActionState<ComplaintActionState | null, FormData>(
    updateComplaintStatus,
    null
  );

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-1">
      <input type="hidden" name="complaint_id" value={complaintId} />
      {status === "baru" && (
        <button
          type="submit"
          name="status"
          value="dalam-penyelesaian"
          disabled={pending}
          className={`${btnSmall} bg-amber-100 text-amber-800 hover:bg-amber-200 disabled:opacity-50`}
        >
          Tandai dalam penyelesaian
        </button>
      )}
      {status !== "selesai" && (
        <button
          type="submit"
          name="status"
          value="selesai"
          disabled={pending}
          className={`${btnSmall} bg-green-600 text-white hover:bg-green-500 disabled:opacity-50`}
        >
          Tandai selesai
        </button>
      )}
      {state && !state.ok && <p className="basis-full text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
