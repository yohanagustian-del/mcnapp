import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActivationForm } from "./activation-form";

/** Halaman aktivasi akun portal kreator (PRD R36/PR-18) — publik, lihat actions.ts. */
export default async function AktivasiPage({
  searchParams,
}: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  let status: "invalid" | "ready" = "invalid";
  let email: string | null = null;

  if (token) {
    const admin = createAdminClient();
    const { data: cu } = await admin
      .from("creator_users").select("email, status").eq("invite_token", token).maybeSingle();
    if (cu && cu.status === "invited") {
      status = "ready";
      email = cu.email;
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs uppercase text-slate-400">MCN MEA · Portal Kreator</p>
        <h1 className="mt-1 text-xl font-semibold">Aktivasi Akun</h1>

        {status === "invalid" ? (
          <div className="mt-6 space-y-4">
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              Link aktivasi tidak valid, sudah dipakai, atau sudah kedaluwarsa. Hubungi CPM kamu untuk
              dikirimkan link baru.
            </p>
            <Link href="/login" className="block text-sm text-slate-600 underline hover:text-slate-900">
              Ke halaman login
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">
              Buat password untuk akun <span className="font-medium">{email}</span>.
            </p>
            <ActivationForm token={token!} />
          </>
        )}
      </div>
    </main>
  );
}
