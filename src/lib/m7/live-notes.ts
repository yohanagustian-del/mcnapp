/**
 * M7 v2 — "Catatan performa" sesi live, DETERMINISTIK (CLAUDE.md #1: tidak ada
 * LLM di jalur ini). Dibuat karena narasi LLM opsional: tanpa ANTHROPIC_API_KEY
 * report peserta sama sekali tidak punya catatan, dan draft yang dikirim ke
 * kreator jadi angka telanjang (temuan QA produksi 2026-09-17).
 *
 * ANGLE-nya kreator, bukan tim internal (revisi user 2026-09-17): yang ditulis
 * di sini adalah apa yang bisa dilakukan kreator di sesi berikutnya — di mana
 * jualannya benar-benar terjadi, produk mana yang dilihat tapi belum dibeli,
 * modal interaksi apa yang sudah dia punya. Peringkat peserta, kontribusi ke
 * GMV project, dan pembanding kohort lain sengaja TIDAK masuk (itu angle tim).
 *
 * Setiap kalimat di sini adalah PERNYATAAN ULANG angka yang sudah ada di report:
 * tidak ada ambang/threshold bisnis yang dipakai untuk menilai bagus-buruk (itu
 * milik app_config, bukan modul teks), dan tidak ada angka yang tidak berasal
 * dari input — jadi tidak mungkin mengarang. Saran tindak lanjut hanya menempel
 * pada pola yang memang terbaca dari data (mis. interval penutup tanpa
 * transaksi, produk berimpresi tanpa pesanan), bukan tebakan.
 */
import type { ProjectReportLive } from "./report-data";

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const n0 = (n: number) => Math.round(n).toLocaleString("id-ID");
const dec = (x: number) => x.toFixed(1).replace(".", ",");
const pc = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;

/** "09:24 dan 09:54" / "09:24, 09:54, dan 10:24" — daftar yang enak dibaca. */
function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} dan ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, dan ${labels[labels.length - 1]}`;
}

/** 120 → "2 jam", 90 → "1,5 jam", 30 → "30 menit". */
function durasi(minutes: number): string {
  if (minutes < 60) return `${n0(minutes)} menit`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? n0(hours) : dec(hours)} jam`;
}

export function buildLiveNotes(live: ProjectReportLive): string[] {
  const notes: string[] = [];
  const timeline = live.timeline;

  // 1. Di mana jualannya benar-benar terjadi, lalu bagian sesi yang kosong.
  if (timeline.length > 0 && live.gmv > 0) {
    const productive = timeline.filter((t) => t.gmv > 0);
    const kalimat: string[] = [];

    if (productive.length > 0 && productive.length <= 3) {
      kalimat.push(
        `Seluruh GMV ${rp(live.gmv)} terjadi di ${n0(productive.length)} dari ${n0(timeline.length)} interval 30 menit: ` +
          `${listLabels(productive.map((t) => t.label))}.`
      );
    } else {
      const peak = timeline.reduce((best, t) => (t.gmv > best.gmv ? t : best), timeline[0]);
      kalimat.push(
        `Penjualan terbesar ada di interval ${peak.label} dengan ${rp(peak.gmv)} (${pc(peak.gmv / live.gmv)} dari total sesi), ` +
          `dan ${n0(productive.length)} dari ${n0(timeline.length)} interval 30 menit menghasilkan transaksi.`
      );
    }

    // Ekor sesi tanpa transaksi — pola yang paling sering bisa langsung diperbaiki.
    if (timeline.length > 1) {
      let tail = 0;
      for (let i = timeline.length - 1; i >= 0 && timeline[i].gmv === 0; i--) tail++;
      if (tail > 0) {
        const firstIdle = timeline[timeline.length - tail];
        const lastLabel = timeline[timeline.length - 1].label;
        const lastViewers = timeline[timeline.length - 1].viewers;
        const peakViewers = timeline.reduce((m, t) => Math.max(m, t.viewers ?? 0), 0);
        kalimat.push(
          `${durasi(tail * 30)} terakhir (${firstIdle.label}–${lastLabel}) nol transaksi` +
            (lastViewers !== null && peakViewers > 0
              ? `, penonton turun dari ${n0(peakViewers)} ke ${n0(lastViewers)}`
              : "") +
            ` — sesi berikutnya bisa ditutup lebih awal, atau bagian itu diisi penawaran penutup supaya penonton bertahan.`
        );
      }
    }
    notes.push(kalimat.join(" "));
  }

  // 2. Seberapa efisien tayangan jadi pesanan, dan produk mana yang belum kepakai.
  if (live.product_impressions > 0) {
    const kalimat: string[] = [];
    kalimat.push(
      `CTR produk ${live.ctr !== null ? pc(live.ctr) : "—"} ` +
        `(${n0(live.product_clicks)} klik dari ${n0(live.product_impressions)} impresi produk)` +
        (live.ctor !== null ? `, CTOR ${pc(live.ctor)} ke ${n0(live.orders)} pesanan` : "") +
        (live.cohort_ctr !== null && live.cohort_creators > 1
          ? `; rata-rata seluruh peserta live project ini ${pc(live.cohort_ctr)}.`
          : `.`)
    );
    if (live.orders > 0) {
      kalimat.push(
        `Nilai per pesanan ${rp(live.gmv / live.orders)}` +
          (live.items_per_order !== null ? ` dari rata-rata ${dec(live.items_per_order)} item per pesanan` : "") +
          `.`
      );
    }
    if (live.top_unsold) {
      kalimat.push(
        `Produk yang paling sering tampil tapi belum menghasilkan pesanan: "${live.top_unsold.name}" ` +
          `(${n0(live.top_unsold.impressions)} impresi) — layak di-pin ulang atau dijelaskan lebih lama di sesi berikutnya.`
      );
    }
    notes.push(kalimat.join(" "));
  }

  // 3. Interaksi penonton — modal yang sudah dipegang untuk sesi berikutnya.
  if (live.views > 0 && (live.likes > 0 || live.comments > 0)) {
    const kalimat: string[] = [];
    kalimat.push(
      `${n0(live.likes)} likes dan ${n0(live.comments)} komentar dari ${n0(live.views)} views` +
        (live.comments > 0 ? ` (${dec((live.comments / live.views) * 100)} komentar per 100 views)` : "") +
        (live.new_followers > 0 ? `, serta ${n0(live.new_followers)} follower baru` : "") +
        `.`
    );
    if (live.comments > 0) {
      kalimat.push(
        `Komentar sebanyak itu bisa langsung dipakai di sesi berikutnya: jawab pertanyaannya di depan kamera, lalu tutup dengan ajakan checkout.`
      );
    }
    notes.push(kalimat.join(" "));
  }

  return notes;
}
