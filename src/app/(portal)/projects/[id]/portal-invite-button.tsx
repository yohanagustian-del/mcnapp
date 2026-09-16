"use client";

import { useState, useTransition } from "react";
import { invitePortalAccount } from "./portal-invite-actions";

const STATUS_LABELS: Record<string, string> = {
  invited: "Menunggu aktivasi", active: "✓ Aktif", suspended: "Ditangguhkan",
};

/** Kolom "Akun Portal" per peserta (R36) — lihat portal-invite-actions.ts untuk batas scope. */
export function PortalInviteButton({
  creatorId, existingStatus,
}: { creatorId: string; existingStatus: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (existingStatus) {
    return <span className="text-xs text-slate-500">{STATUS_LABELS[existingStatus] ?? existingStatus}</span>;
  }

  function onInvite() {
    setError(null);
    const fd = new FormData();
    fd.set("creator_id", creatorId);
    fd.set("email", email);
    startTransition(async () => {
      const res = await invitePortalAccount(fd);
      if (res.ok) setToken(res.token);
      else setError(res.error);
    });
  }

  if (token) {
    return (
      <div className="text-xs">
        <p className="text-green-700">Undangan dibuat — kirim token ini manual (WA):</p>
        <input readOnly value={token} onFocus={(e) => e.target.select()}
          className="mt-1 w-40 rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px]" />
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-blue-700 hover:underline">
        Undang ke Portal
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email kreator"
        className="w-40 rounded border border-slate-300 px-1 py-0.5 text-xs"
      />
      <button onClick={onInvite} disabled={pending}
        className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white disabled:opacity-50">
        {pending ? "Mengirim…" : "Kirim Undangan"}
      </button>
      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}
