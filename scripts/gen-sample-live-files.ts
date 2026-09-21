/**
 * Generator FILE CONTOH sesi live TikTok LIVE Center untuk QA manual.
 *
 * Membuat pasangan .xlsx (Product + Trend Stats) dengan header, nilai, dan NAMA
 * FILE persis seperti export aslinya — jadi bisa langsung di-drop ke form upload
 * di `/schedule/live/[slotId]` (Jadwal Live) maupun tab Performa Special Project.
 *
 * Kenapa perlu: export TikTok sungguhan belum tersedia di repo
 * (`docs/data-samples/` hanya berisi README), sementara alur uploadnya sudah
 * rilis ke produksi. Tanpa file contoh, QA manual tidak bisa dimulai sama sekali.
 * Isi file ini DETERMINISTIK dan bukan data nyata siapa pun.
 *
 * Bentuk sheet-nya dibangun modul yang SAMA dengan yang dipakai tes end-to-end
 * (`src/lib/m7/live-sample.ts`) — kalau header export berubah, satu tempat saja
 * yang disunting, dan tesnya ikut menangkap.
 *
 * JALANKAN MANUAL:
 *   npx tsx scripts/gen-sample-live-files.ts [outputDir] [username] [tanggal-ISO]
 *   contoh: npx tsx scripts/gen-sample-live-files.ts ./sample-live tesakun 2026-09-17
 *   default: ./sample-live, username "tesakun", tanggal hari ini
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { buildLiveSampleFiles, defaultSampleSpec, sampleDateLabel } from "../src/lib/m7/live-sample";

function main() {
  const outDir = process.argv[2] ?? "./sample-live";
  const username = process.argv[3] ?? "tesakun";
  const date = process.argv[4] ?? new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Tanggal harus format YYYY-MM-DD, dapat: ${date}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  // Dua sesi di hari yang sama, jam TIDAK bertumpuk — supaya V3 (tumpang tindih)
  // dan V7 (nomor sesi ganda) ikut teruji di UI, bukan hanya jalur mulus.
  const specs = [
    defaultSampleSpec({ username, date, sessionNo: 1, startTime: "13:00", intervals: 4 }),
    defaultSampleSpec({ username, date, sessionNo: 2, startTime: "19:00", intervals: 5 }),
  ];

  const written: string[] = [];
  for (const spec of specs) {
    for (const file of buildLiveSampleFiles(spec)) {
      const path = join(outDir, file.name);
      writeFileSync(path, file.data);
      written.push(path);
    }
  }

  const totalGmv = specs[0].products.reduce((a, p) => a + p.gmv, 0);

  console.log(`\n${written.length} file contoh ditulis ke ${outDir}:`);
  for (const p of written) console.log(`  ${p}`);
  console.log("");
  console.log(`Kreator (username di nama file): @${username}`);
  console.log(`Tanggal sesi                   : ${sampleDateLabel(date)}`);
  console.log("");
  console.log("Cara pakai (Jadwal Live):");
  console.log(`  1. Pastikan ada slot untuk kreator @${username} pada ${date}, statusnya bukan OFF/batal.`);
  console.log("  2. Buka /schedule → klik \"Data & report live →\" pada slot itu.");
  console.log("  3. Drop KEEMPAT file sekaligus → Pratinjau → Simpan Sesi → Generate Report.");
  console.log("");
  console.log("Yang seharusnya terlihat:");
  console.log(`  - 2 sesi, masing-masing GMV Rp${totalGmv.toLocaleString("id-ID")}, V1–V7 hijau semua`);
  console.log("  - Sesi 1 13:00–14:30 (90 menit), Sesi 2 19:00–21:00 (120 menit)");
  console.log("  - 4 produk per sesi: 2 laku, 2 nol pesanan (Sunscreen SPF50 = produk paling banyak");
  console.log("    dilihat tapi belum laku, muncul di catatan report)");
  console.log("");
  console.log("Uji penolakan (opsional): unggah file yang SAMA ke sebuah Special Project —");
  console.log("V4 harus menolak dan menyebut slot jadwal yang sudah memegang file itu.");
}

main();
