/** MIME .xlsx — dipakai untuk semua unduhan template Excel. */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Alirkan hasil server action (file base64) ke unduhan browser.
 *
 * Server action hanya bisa mengembalikan nilai serializable, jadi file biner
 * dikirim sebagai base64 lalu dirakit kembali di sini. Client-only — memakai
 * atob/URL/document.
 */
export function downloadBase64File(filename: string, base64: string, mime: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
