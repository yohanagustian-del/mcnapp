/**
 * Sharing Komisi kreator (`creators.commission_share`) disimpan sebagai fraksi
 * (0.22 = 22%). Form menerima/menampilkan persen; modul ini satu-satunya tempat
 * konversinya. Nilai lama >1 ditoleransi sebagai persen (sama seperti UI tabel).
 */

/** Fraksi tersimpan → persen untuk ditampilkan di input form ("" bila kosong). */
export function commissionShareToPct(v: number | string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const pct = n <= 1 ? n * 100 : n;
  return String(Number(pct.toFixed(2)));
}

export type ParsedCommissionShare =
  | { ok: true; fraction: number | null }
  | { ok: false; error: string };

/** Input persen ("17" / "17,5") → fraksi. Kosong → null (sharing dikosongkan). */
export function parseCommissionSharePct(raw: string): ParsedCommissionShare {
  const s = raw.trim().replace(",", ".").replace(/%$/, "").trim();
  if (!s) return { ok: true, fraction: null };
  const pct = Number(s);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { ok: false, error: "Sharing Komisi harus angka 0–100 (mis. 17 untuk 17%)" };
  }
  // Bulatkan ke 4 desimal fraksi supaya 17/100 tidak menyimpan noise float.
  return { ok: true, fraction: Math.round(pct * 100) / 10000 };
}
