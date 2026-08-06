const COMPASS_URL = "https://partner.tiktokshop.com/compass/custom-report";

/**
 * Tutorial cara mengunduh file untuk "Upload Master Product List".
 *
 * Ditulis sebagai <details> yang terbuka default: langkahnya pendek, dan tim yang
 * baru pertama kali mengunduh custom report TikTok Partner Compass selalu tersesat
 * di setelan dimensi/kategori — itu sebabnya urutan ceklisnya dieja satu per satu.
 */
export function UploadTutorial() {
  return (
    <details open className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Cara mengunduh file untuk “Upload Master Product List”
      </summary>

      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>
          Buka{" "}
          <a
            href={COMPASS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-blue-700 underline"
          >
            {COMPASS_URL}
          </a>
        </li>
        <li>
          Login. <span className="text-slate-500">(Akunnya tanyakan ke tim MCN.)</span>
        </li>
        <li>
          Klik <strong>Analytics</strong> → <strong>Custom report</strong>.
        </li>
        <li>
          Ikuti setelan berikut:
          <ol className="mt-1 list-[lower-alpha] space-y-1 pl-5 text-slate-700">
            <li>
              Masuk ke bagian role <strong>TAP</strong>.
            </li>
            <li>
              Ceklis bagian: <strong>Product</strong>, <strong>Shop</strong>, dan{" "}
              <strong>Product category</strong>.
            </li>
            <li>Setting tanggal dari awal hingga akhir yang dapat di-download.</li>
            <li>
              Ganti <strong>Level 1 category</strong> → <strong>Level 2 category</strong>.
            </li>
          </ol>
        </li>
        <li>
          Download hasilnya, lalu unggah file itu di form <strong>Upload Master Product List</strong>{" "}
          di bawah.
        </li>
      </ol>

      <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
        File hasil download bisa langsung diunggah apa adanya — baris <em>Summary</em> di paling atas
        otomatis dilewati, dan satu produk yang muncul di beberapa campaign/periode digabung jadi satu
        baris katalog (metrik GMV/order/komisi dijumlahkan, jumlah kreator diambil yang terbesar).
      </p>
    </details>
  );
}
