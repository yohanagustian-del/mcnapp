import { ForgotPasswordForm } from "./form";

const ERROR_MESSAGES: Record<string, string> = {
  link: "Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru di bawah.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Lupa Password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Masukkan email akun Anda. Kami kirim tautan untuk membuat password baru.
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {ERROR_MESSAGES[error] ?? "Terjadi kesalahan. Coba lagi."}
          </p>
        )}

        <ForgotPasswordForm />

        <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
          <span className="font-medium">Kreator:</span> tidak menerima email, atau emailnya sudah tidak aktif? Hubungi
          CM kamu dan minta <span className="font-medium">Reset Password</span>. CM akan mengirim password sementara
          lewat WhatsApp, lalu kamu diminta membuat password baru saat login.
        </p>
      </div>
    </main>
  );
}
