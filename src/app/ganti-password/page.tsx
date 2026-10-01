import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logout } from "@/app/login/actions";
import { ForcedPasswordForm } from "./form";

/**
 * Wajib ganti password — kreator yang login dengan password sementara dari staff
 * (undangan / Reset Password) diarahkan ke sini oleh requireCreator(). Sengaja di luar
 * layout /portal (layout itu sendiri yang mengalihkan ke sini).
 */
export default async function GantiPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?portal=creator");

  const { data: cu } = await createAdminClient()
    .from("creator_users")
    .select("email, status, must_change_password")
    .eq("auth_uid", user.id)
    .maybeSingle();
  if (!cu || cu.status === "suspended") redirect("/login?portal=creator&error=no_creator");
  if (!cu.must_change_password) redirect("/portal");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs uppercase text-slate-400">MCN MEA · Portal Kreator</p>
        <h1 className="mt-1 text-xl font-semibold">Buat Password Baru</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kamu masuk dengan password sementara untuk <span className="font-medium">{cu.email}</span>. Buat
          password sendiri dulu sebelum membuka portal.
        </p>
        <ForcedPasswordForm />
        <form action={logout} className="mt-4">
          <button className="text-sm text-slate-500 underline hover:text-slate-900">Keluar</button>
        </form>
      </div>
    </main>
  );
}
