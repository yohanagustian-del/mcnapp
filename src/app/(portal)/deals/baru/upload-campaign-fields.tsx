import type { MemberOption } from "./deal-form";

const inputCls = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * Pertanyaan tambahan untuk "Upload Produk Deal Lama via Excel".
 *
 * File export TAP tidak membawa Deal by maupun PIC TAP — keduanya dimensi MEA, bukan
 * data platform. Karena satu file upload = satu deal, keduanya cukup ditanyakan SEKALI
 * di sini lalu diisikan server ke setiap kartu di file itu.
 *
 * Keduanya opsional: dikosongkan → kolomnya tidak disentuh sama sekali, bukan
 * dikosongkan pada kartu yang sudah terisi. Kolom "Nama BD" tidak ditanyakan — ia
 * terisi otomatis dari akun yang meng-upload.
 *
 * Tipe Campaign, Ads Budget & Service Fee TIDAK lagi ditanyakan di sini: kedua nominal
 * itu milik pasangan (project, shop) dan diisi lewat tombol Edit di detail Project BD,
 * jadi upload deal tidak boleh lagi menuliskannya ke kartu.
 *
 * Tanpa state apa pun lagi, komponen ini tidak perlu jadi client component.
 */
export function UploadCampaignFields({
  picOptions,
  dealByOptions,
}: {
  picOptions: MemberOption[];
  dealByOptions: MemberOption[];
}) {
  const dealByGroups = [...new Set(dealByOptions.map((o) => o.group ?? ""))];

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Deal by
          <select name="deal_by" defaultValue="" className={inputCls}>
            <option value="">— tidak diisi —</option>
            {dealByGroups.map((g) => (
              <optgroup key={g} label={g || "Lainnya"}>
                {dealByOptions
                  .filter((o) => (o.group ?? "") === g)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          PIC TAP
          <select name="pic_tap" defaultValue="" className={inputCls}>
            <option value="">— tidak diisi —</option>
            {picOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        <strong>Deal by</strong> &amp; <strong>PIC TAP</strong> opsional — dikosongkan berarti kolom
        itu tidak disentuh pada kartu yang sudah ada. Kolom <strong>Nama BD</strong> terisi otomatis
        dari akun Anda. Ketiganya ikut tampil di tabel <strong>Shop</strong> (tab Deal Brand).{" "}
        <strong>Ads Budget</strong> &amp; <strong>Service Fee</strong> tidak ditanyakan di sini:
        keduanya diisi per shop di dalam project lewat tab <strong>Project BD</strong>.
      </p>
    </div>
  );
}
