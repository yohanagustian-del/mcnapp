import Link from "next/link";
import { login } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "Email dan password wajib diisi.",
  invalid: "Email atau password salah.",
  no_member: "Akun tidak terdaftar sebagai anggota tim aktif. Hubungi Management.",
};

const SUCCESS_MESSAGES: Record<string, string> = {
  reset: "Password baru tersimpan. Silakan masuk dengan password tersebut.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">MCN MEA Platform</h1>
        <p className="mt-1 text-sm text-slate-500">Masuk dengan akun terdaftar Anda.</p>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {ERROR_MESSAGES[error] ?? "Terjadi kesalahan. Coba lagi."}
          </p>
        )}

        {success && SUCCESS_MESSAGES[success] && (
          <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
            {SUCCESS_MESSAGES[success]}
          </p>
        )}

        <form action={login} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">Email</label>
            <input
              id="email" name="email" type="email" required autoComplete="email"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="nama@meagency.co.id"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="password" className="block text-sm font-medium">Password</label>
              <Link
                href="/login/lupa-password"
                className="text-xs text-slate-500 underline hover:text-slate-800"
              >
                Lupa password?
              </Link>
            </div>
            <input
              id="password" name="password" type="password" required autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Masuk
          </button>
        </form>
      </div>
    </main>
  );
}
