const TAP_URL = "https://partner.tiktokshop.com/";

/**
 * Tutorial cara mengunduh file untuk "Upload Master Product List".
 *
 * Ditulis sebagai <details> yang terbuka default: langkahnya pendek dan jelas
 * untuk mengekspor product list dari TAP dengan commission info.
 */
export function UploadTutorial() {
  return (
    <details open className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Cara mengunduh file untuk "Upload Master Product List"
      </summary>

      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>
          Buka{" "}
          <a
            href={TAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-blue-700 underline"
          >
            {TAP_URL}
          </a>
        </li>
        <li>Login dengan akun TAP (tanyakan ke tim MCN jika belum punya)</li>
        <li>Pilih role TAP di sidebar kiri</li>
        <li>Klik menu <strong>Creator Matchmaking</strong> → <strong>Manage</strong></li>
        <li>Pilih salah satu room campaign yang ingin di-export</li>
        <li>Klik tombol <strong>View Detail</strong> pada room campaign tersebut</li>
        <li>Scroll ke bawah dan klik tab <strong>Approved</strong></li>
        <li>Klik tab <strong>Products</strong></li>
        <li>Ubah kolom "Product Name" menjadi "Shop Name" untuk sorting yang lebih mudah</li>
        <li>Filter data sesuai shop name yang akan di-export</li>
        <li>Centang kotak untuk memilih semua product (select all)</li>
        <li>Klik tombol <strong>Export Link</strong></li>
        <li>Isi kolom <strong>Creator Affiliate Commission</strong> dengan persentase komisi (contoh: 10)</li>
        <li>Klik tombol <strong>Export Link</strong> sekali lagi untuk download</li>
        <li>Upload file CSV yang sudah di-download di form di bawah</li>
      </ol>

      <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
        File hasil download bisa langsung diunggah apa adanya — baris <em>Summary</em> di paling atas
        otomatis dilewati. Sistem membaca header kolom secara fleksibel dan mencocokkan dengan nama standar
        (Product ID, Shop Name, Commission Rate, dll). Satu produk yang muncul di beberapa campaign/periode
        akan digabung jadi satu baris katalog (metrik dijumlahkan, jumlah kreator diambil yang terbesar).
      </p>
    </details>
  );
}
