import { requireMember } from "@/lib/rbac";
import { ChangePasswordForm } from "./password-form";

export default async function AkunPasswordPage() {
  const member = await requireMember();

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold">Ganti Password</h1>
      <p className="mt-1 text-sm text-slate-500">
        Akun <span className="font-medium">{member.email}</span>. Ganti password default
        Anda dengan password pribadi. Butuh password lama untuk konfirmasi.
      </p>

      <div className="mt-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
