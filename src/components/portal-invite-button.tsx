"use client";

import { useState, useTransition } from "react";
import {
  invitePortalAccount,
  resetPortalPassword,
  type InvitePortalResult,
  type PortalAccountStatus,
} from "@/lib/portal/invite";
import { portalCredentialsMessage, type PortalCredentials } from "@/lib/portal/credentials";

const STATUS_LABELS: Record<PortalAccountStatus | "none", string> = {
  none: "Belum diundang", invited: "Diundang", active: "✓ Aktif", suspended: "Ditangguhkan",
};
const STATUS_STYLES: Record<PortalAccountStatus | "none", string> = {
  none: "bg-slate-100 text-slate-600", invited: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800", suspended: "bg-red-100 text-red-800",
};
const linkBtn = "text-xs text-blue-700 hover:underline disabled:opacity-50";

/** Shown once after an invite / reset: the temporary password is never stored, so it can't be shown again. */
function CredentialsPanel({ credentials }: { credentials: PortalCredentials }) {
  const [copied, setCopied] = useState(false);
  const message = portalCredentialsMessage(credentials);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="w-56 rounded-md border border-green-200 bg-green-50 p-2 text-xs">
      <p className="font-medium text-green-800">Kirim ke kreator lewat WA:</p>
      <p className="mt-1 text-slate-600">Email: <span className="font-mono">{credentials.email}</span></p>
      <p className="text-slate-600">
        Password sementara: <span className="select-all font-mono font-semibold text-slate-900">{credentials.password}</span>
      </p>
      <button type="button" onClick={copy} className="mt-1 rounded bg-slate-900 px-2 py-0.5 text-white">
        {copied ? "Tersalin ✓" : "Salin pesan WA"}
      </button>
      <p className="mt-1 text-[10px] text-slate-500">
        Password hanya tampil sekali. Kreator wajib membuat password baru saat login pertama.
      </p>
    </div>
  );
}

/**
 * Creator Portal account status + invite / temporary-password actions (R36, user
 * decision 2026-10-01 A+B). The one UI for every place staff manage portal accounts
 * (project participants, /creators/[id], CM Workspace). Status comes from
 * loadPortalStatus(); gate + scope live in lib/portal/invite.ts — render only for
 * viewers with invite rights (portalInviteGate) and in scope.
 */
export function PortalInviteButton({
  creatorId, existingStatus, projectId, canReset = false,
}: {
  creatorId: string;
  existingStatus: PortalAccountStatus | null;
  /** Set when rendered in a Special Project: lets project-only inviters (Q5) invite participants. */
  projectId?: string | number;
  /** `m9.invite` holders: "Reset Password" on an active account (the action re-checks). */
  canReset?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [credentials, setCredentials] = useState<PortalCredentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const status = existingStatus ?? "none";
  const badge = (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );

  function run(action: (fd: FormData) => Promise<InvitePortalResult>, withEmail = "") {
    setError(null);
    const fd = new FormData();
    fd.set("creator_id", creatorId);
    fd.set("email", withEmail);
    if (projectId !== undefined) fd.set("project_id", String(projectId));
    startTransition(async () => {
      const res = await action(fd);
      if (!res.ok) setError(res.error);
      else if (res.credentials) setCredentials(res.credentials);
      else setError("Akun kreator ini sudah aktif.");
    });
  }

  const errorLine = error && <p className="text-xs text-red-700">{error}</p>;

  if (credentials) return <CredentialsPanel credentials={credentials} />;

  if (status === "suspended") return badge;

  if (status === "active") {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          {badge}
          {canReset && (
            <button
              onClick={() => {
                if (confirm("Buat password sementara baru untuk kreator ini? Password lamanya tidak berlaku lagi.")) {
                  run(resetPortalPassword);
                }
              }}
              disabled={pending}
              className={linkBtn}
            >
              {pending ? "Memproses…" : "Reset Password"}
            </button>
          )}
        </div>
        {errorLine}
      </div>
    );
  }

  // Invited but never logged in: the first temporary password can't be shown again
  // (never stored) — mint a new one instead.
  if (status === "invited") {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          {badge}
          <button onClick={() => run(invitePortalAccount)} disabled={pending} className={linkBtn}>
            {pending ? "Memproses…" : "Buat Password Baru"}
          </button>
        </div>
        {errorLine}
      </div>
    );
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {badge}
        <button onClick={() => setOpen(true)} className={linkBtn}>
          Undang ke Portal
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email kreator" type="email"
        className="w-40 rounded border border-slate-300 px-1 py-0.5 text-xs"
      />
      <button onClick={() => run(invitePortalAccount, email)} disabled={pending}
        className="rounded bg-slate-900 px-2 py-0.5 text-xs text-white disabled:opacity-50">
        {pending ? "Membuat akun…" : "Buat Akun & Password"}
      </button>
      {errorLine}
    </div>
  );
}
