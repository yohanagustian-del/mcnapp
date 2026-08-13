const TAP_URL = "https://partner.tiktokshop.com/";

/**
 * Tutorial cara mengunduh file untuk "Upload Master Product List".
 *
 * Sumbernya alur klik 15 langkah dari tim; di sini digabung jadi 7 langkah —
 * klik yang berurutan di layar yang sama ditulis dalam satu baris. Yang dieja
 * terpisah hanya langkah yang sering keliru: mengganti kolom filter ke Shop name
 * dan mengisi persen komisi sebelum export.
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
            href={TAP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-blue-700 underline"
          >
            {TAP_URL}
          </a>{" "}
          lalu pilih role <strong>TAP</strong>.{" "}
          <span className="text-slate-500">(Akunnya tanyakan ke tim MCN.)</span>
        </li>
        <li>
          Sidebar kiri: <strong>Creator Matchmaking</strong> → <strong>Manage</strong>.
        </li>
        <li>
          Pilih room campaign, klik <strong>View detail</strong>.
        </li>
        <li>
          Scroll sedikit ke bawah, buka tab <strong>Approved</strong> →{" "}
          <strong>Products</strong>.
        </li>
        <li>
          Ganti kolom filter dari <strong>Product name</strong> ke <strong>Shop name</strong>, lalu
          filter shop yang mau diexport.
        </li>
        <li>
          Centang <strong>select all</strong>, klik <strong>Export link</strong>.
        </li>
        <li>
          Isi <strong>Creator affiliate commission</strong> (angka persen, mis. 7), klik{" "}
          <strong>Export link</strong> sekali lagi → file terunduh.
        </li>
      </ol>

      <p className="mt-3 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
        File hasil unduhan diunggah apa adanya — tidak perlu dirapikan dulu. Yang dibaca: Campaign
        ID, Product ID, product name, Sale price, Shop name, masa berlaku produk, keempat rate
        komisi (kreator &amp; partner, masing-masing versi biasa dan Shop Ads), dan Product link.
        Kolom gambar dan kolom terakhir yang bertanda <em>“only for checking”</em> sengaja diabaikan.
        Satu produk yang muncul di beberapa campaign digabung jadi satu baris katalog.
      </p>
    </details>
  );
}
