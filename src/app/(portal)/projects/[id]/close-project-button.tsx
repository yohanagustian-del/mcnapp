"use client";

/**
 * Tombol "Tutup Project (hitung hasil)" — submit form status={selesai} yang sama
 * (form action={setProjectStatus} di page.tsx), hanya menambah konfirmasi native
 * sebelum submit karena aksinya mengunci hasil akhir (achievement/margin) dan
 * hanya Director/Head yang bisa membuka kembali (R2).
 */
export function CloseProjectButton() {
  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (
      !confirm(
        "Yakin tutup project ini dan hitung hasil akhir?\n\nProgres GMV & margin saat ini akan dikunci sebagai hasil project. Setelah ditutup, hanya Director/Head yang bisa membuka kembali (untuk koreksi upload terlambat)."
      )
    ) {
      e.preventDefault();
    }
  }

  return (
    <button
      type="submit"
      name="status"
      value="selesai"
      onClick={onClick}
      className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
    >
      Tutup Project (hitung hasil)
    </button>
  );
}
