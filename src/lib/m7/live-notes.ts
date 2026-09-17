/**
 * M7 v2 — "Catatan performa" sesi live, DETERMINISTIK (CLAUDE.md #1: tidak ada
 * LLM di jalur ini). Dibuat karena narasi LLM opsional: tanpa ANTHROPIC_API_KEY
 * report peserta sama sekali tidak punya catatan, dan draft yang dikirim ke
 * kreator jadi angka telanjang (temuan QA produksi 2026-09-17).
 *
 * Setiap kalimat di sini adalah PERNYATAAN ULANG angka yang sudah ada di report:
 * tidak ada ambang/threshold bisnis yang dipakai untuk menilai bagus-buruk (itu
 * milik app_config, bukan modul teks), dan tidak ada angka yang tidak berasal
 * dari input — jadi tidak mungkin mengarang. Saran tindak lanjut hanya menempel
 * pada pola yang memang terbaca dari data (mis. interval penutup tanpa
 * transaksi), bukan tebakan.
 */
import type { ProjectReportLive } from "./report-data";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const n0 = (n: number) => Math.round(n).toLocaleString("id-ID");
const pc = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;

export function buildLiveNotes(live: ProjectReportLive): string[] {
  const notes: string[] = [];
  const timeline = live.timeline;

  // 1. Di mana GMV benar-benar terjadi.
  if (timeline.length > 0 && live.gmv > 0) {
    const peak = timeline.reduce((best, t) => (t.gmv > best.gmv ? t : best), timeline[0]);
    const productive = timeline.filter((t) => t.gmv > 0).length;
    notes.push(
      `Puncak penjualan di interval ${peak.label} dengan ${rp(peak.gmv)} (${pc(peak.gmv / live.gmv)} dari total sesi). ` +
        `Dari ${n0(timeline.length)} interval 30 menit, ${n0(productive)} menghasilkan transaksi.`
    );
  }

  // 2. Ekor sesi tanpa transaksi — pola yang paling sering bisa langsung diperbaiki.
  if (timeline.length > 1 && live.gmv > 0) {
    let tail = 0;
    for (let i = timeline.length - 1; i >= 0 && timeline[i].gmv === 0; i--) tail++;
    if (tail > 0) {
      const firstIdle = timeline[timeline.length - tail];
      const lastViewers = timeline[timeline.length - 1].viewers;
      const peakViewers = timeline.reduce((m, t) => Math.max(m, t.viewers ?? 0), 0);
      notes.push(
        `Sesi ditutup dengan ${n0(tail)} interval terakhir tanpa transaksi (sejak ${firstIdle.label})` +
          (lastViewers !== null && peakViewers > 0
            ? `, penonton turun dari puncak ${n0(peakViewers)} ke ${n0(lastViewers)}`
            : "") +
          `. Untuk sesi berikutnya, bagian ini bisa dipangkas atau diisi penawaran penutup.`
      );
    }
  }

  // 3. Rantai tayang → beli, apa adanya.
  if (live.product_impressions > 0) {
    notes.push(
      `Rantai konversi: ${n0(live.product_impressions)} impresi produk → ${n0(live.product_clicks)} klik` +
        (live.ctr !== null ? ` (CTR ${pc(live.ctr)})` : "") +
        ` → ${n0(live.orders)} pesanan` +
        (live.ctor !== null ? ` (CTOR ${pc(live.ctor)})` : "") +
        (live.add_to_cart > 0 ? `, dengan ${n0(live.add_to_cart)} masuk keranjang` : "") +
        `.`
    );
  }

  // 4. Interaksi penonton — modal untuk sesi berikutnya.
  if (live.views > 0 && (live.likes > 0 || live.comments > 0)) {
    notes.push(
      `Interaksi: ${n0(live.likes)} likes dan ${n0(live.comments)} komentar dari ${n0(live.views)} views` +
        (live.new_followers > 0 ? `, serta ${n0(live.new_followers)} follower baru` : "") +
        `.`
    );
  }

  return notes;
}
