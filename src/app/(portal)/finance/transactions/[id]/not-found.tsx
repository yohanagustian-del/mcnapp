import Link from "next/link";

/**
 * Fallback route-level untuk nomor transaksi yang tidak ada.
 *
 * Kenapa bukan 404 kosong: nomor transaksi (TRX-YYYYMM-NNNN) dibagikan manusia —
 * ditempel di invoice, dikirim lewat chat, dipakai saat QA. Ketika nomornya salah
 * ketik atau migration modul ini belum di-apply, halaman kosong tidak memberi tahu
 * MANA dari dua sebab itu yang terjadi, dan itu persis kebingungan yang muncul saat
 * QA `/finance/transactions/TRX-202608-0001` sebelum tabel finance ada.
 */
export default function TransactionNotFound() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/finance/transactions" className="text-sm text-slate-500 hover:underline">
        ← Kembali ke daftar transaksi
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Transaksi tidak ditemukan</h1>
      <p className="mt-2 text-sm text-slate-600">
        Nomor transaksi pada URL ini tidak ada di database. Dua kemungkinan:
      </p>

      <ol className="mt-4 space-y-3 text-sm text-slate-700">
        <li className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-medium">1. Nomornya salah / transaksi belum dicatat</p>
          <p className="mt-1 text-slate-600">
            Nomor transaksi berformat <code className="rounded bg-slate-100 px-1">TRX-YYYYMM-NNNN</code>{" "}
            dan dibuat berurutan per bulan saat transaksi dicatat — bukan ditulis manual. Cek
            daftar transaksi untuk nomor yang benar, atau catat transaksinya lewat tombol{" "}
            <strong>Catat transaksi baru</strong>.
          </p>
        </li>
        <li className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="font-medium">2. Migration modul finance belum di-apply</p>
          <p className="mt-1 text-slate-600">
            Kalau daftar transaksi juga kosong total, jalankan migration{" "}
            <code className="rounded bg-slate-100 px-1">0031_role_finance_lead.sql</code> lalu{" "}
            <code className="rounded bg-slate-100 px-1">0032_finance_transactions.sql</code> (urut,
            sebagai dua transaksi terpisah), lalu catat transaksi pertama.
          </p>
        </li>
      </ol>

      <Link
        href="/finance/transactions"
        className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Buka daftar transaksi
      </Link>
    </div>
  );
}
