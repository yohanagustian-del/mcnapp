import { ResetPasswordForm } from "./form";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Buat Password Baru</h1>
        <p className="mt-1 text-sm text-slate-500">
          Setelah disimpan, semua sesi lama akan keluar dan Anda login ulang.
        </p>

        <ResetPasswordForm />
      </div>
    </main>
  );
}
