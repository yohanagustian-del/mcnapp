"use client";

import { useState, useTransition } from "react";
import { invitePortalAccount, type PortalAccountStatus } from "@/lib/portal/invite";

const STATUS_LABELS: Record<PortalAccountStatus | "none", string> = {
  none: "Belum diundang", invited: "Diundang", active: "✓ Aktif", suspended: "Ditangguhkan",
};
const STATUS_STYLES: Record<PortalAccountStatus | "none", string> = {
  none: "bg-slate-100 text-slate-600", invited: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800", suspended: "bg-red-100 text-red-800",
};

/**
 * Creator Portal account status + invite action (R36). The one UI for every
 * place staff invite creators (project participants, /creators/[id], CM
 * Workspace). Status comes from loadPortalStatus(); gate + scope live in
 * lib/portal/invite.ts — render only for viewers with invite rights (portalInviteGate) and in scope.
 */
export function PortalInviteButton({
  creatorId, existingStatus, projectId,
}: {
  creatorId: string;
  existingStatus: PortalAccountStatus | null;
  /** Set when rendered in a Special Project: lets project-only inviters (Q5) invite participants. */
  projectId?: string | number;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const status = existingStatus ?? "none";
  const badge = (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );

  function submit(withEmail: string) {
    setError(null);
    const fd = new FormData();
    fd.set("creator_id", creatorId);
    fd.set("email", withEmail);
    if (projectId !== undefined) fd.set("project_id", String(projectId));
    startTransition(async () => {
      const res = await invitePortalAccount(fd);
      if (res.ok) setLink(res.link);
      else setError(res.error);
    });
  }

  if (link) {
    return (
      <div className="text-xs">
        <p className="text-green-700">Undangan dibuat — kirim link ini manual (WA):</p>
        <input readOnly value={link} onFocus={(e) => e.target.select()}
          className="mt-1 w-40 rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px]" />
      </div>
    );
  }

  // Active/suspended accounts have nothing left to invite.
  if (status === "active" || status === "suspended") return badge;

  // Already invited: the action re-shows the same token's link (no new token).
  if (status === "invited") {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          {badge}
          <button onClick={() => submit("")} disabled={pending}
            className="text-xs text-blue-700 hover:underline disabled:opacity-50">
            {pending ? "Memuat…" : "Lihat link"}
          </button>
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {badge}
        <button onClick={() => setOpen(true)} className="text-xs text-blue-700 hover:underline">
          Undang ke Portal
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email kreator"
        className="w-40 rounded border border-slate-300 px-1 py-0.5 text-xs"
      />
      <button onClick={() => submit(email)} disabled={pending}
        className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white disabled:opacity-50">
        {pending ? "Mengirim…" : "Kirim Undangan"}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
