/**
 * Generator FILE CONTOH untuk QA analisa kebocoran link (M4, in-platform compute).
 *
 * Membuat 3 file .xlsx dengan bentuk/nama kolom PERSIS seperti export platform:
 *   1. sample_mcn_<week>.xlsx    — MCN report (semua transaksi), header "Custom report" 2026-07
 *   2. sample_tap_<week>.xlsx    — TAP report (via agency link), header Bahasa Indonesia
 *   3. sample_master_shop.xlsx   — Master Data Shop (kolom "Shop ID"), input ke-3 opsional
 *
 * Dipakai untuk QA di STAGING (project Supabase "MCN MEA Staging") karena DB staging
 * kosong: seed kreator (qa_creator_satu / qa_creator_dua) dan master shop QA sudah
 * ditulis ke staging, dan file ini yang diunggah lewat UI (/ingest atau /link-leakage).
 *
 * Angka disusun supaya semua cabang logika kelihatan:
 *   - qa_creator_satu : bocor sebagian di shop ber-deal (P1 sebagian, P2 bocor total)
 *   - qa_creator_dua  : 100% via agency link (tidak bocor)
 *   - qa_creator_tiga : hanya jualan di shop TANPA deal → peluang BD, status belum_ada_link
 *   - shop deal KADALUARSA yang masih transaksi → alert deal_expired + peluang BD (re-deal)
 *   - satu produk dengan TAP > MCN (over-report) supaya beda angka basis-produk vs
 *     basis-shop kelihatan (rumus resmi vs rumus artifak lama)
 *
 * Deterministik, tanpa DB, tanpa token AI. JALANKAN MANUAL:
 *   npx tsx scripts/gen-sample-leak-files.ts [outputDir]   (default: ./sample-data)
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";

const WEEK_START = "2026-07-01";
const WEEK_END = "2026-07-07";
const PERIOD = `${WEEK_START}-${WEEK_END}`;

// Shop id sama dengan seed cooperating_shops di staging (lihat HANDOFF).
const SHOP_DEAL = "7490000000000000001"; // deal aktif (deal_end 2026-12-31)
const SHOP_EXPIRED = "7490000000000000002"; // deal kadaluarsa (deal_end 2026-06-01)
const SHOP_NO_DEAL_END = "7490000000000000003"; // ada di master, deal_end null → aktif
const SHOP_NON_DEAL = "7490000000000000009"; // tidak ada di master → peluang BD

const MCN_HEADER = [
  "Date", "Creator username", "Creator follower count", "Product ID", "Product info",
  "Shop ID", "Shop name", "Level 1 category", "Level 2 category",
  "Creator-attributed GMV", "Creator live-attributed GMV", "Affiliate video-attributed GMV",
  "Direct GMV", "Creator-attributed orders", "Creator-attributed items sold",
];

/** [creator, followers, productId, productName, shopId, shopName, cat1, cat2, gmv, liveGmv, videoGmv, directGmv, orders, items] */
const MCN_ROWS: Array<[string, string, string, string, string, string, string, string, string, string, string, string, string, string]> = [
  // qa_creator_satu — shop ber-deal: P1 bocor sebagian, P2 bocor total, P4 over-report TAP
  ["qa_creator_satu", "431.936", "P1", "Serum Wajah Glow", SHOP_DEAL, "QA Shop Deal Aktif", "Beauty", "Skincare", "Rp3.000.000", "Rp2.000.000", "Rp1.000.000", "Rp200.000", "30", "30"],
  ["qa_creator_satu", "431.936", "P2", "Sabun Muka Lembut", SHOP_DEAL, "QA Shop Deal Aktif", "Beauty", "Skincare", "Rp2.000.000", "Rp0", "Rp2.000.000", "Rp0", "20", "20"],
  ["qa_creator_satu", "431.936", "P4", "Toner Hydrating", SHOP_DEAL, "QA Shop Deal Aktif", "Beauty", "Skincare", "Rp1.000.000", "Rp0", "Rp1.000.000", "Rp0", "10", "10"],
  // qa_creator_satu — shop ada di master tanpa deal_end (dianggap aktif) dan tertutup TAP
  ["qa_creator_satu", "431.936", "P5", "Dress Casual", SHOP_NO_DEAL_END, "QA Shop Tanpa Deal End", "Fashion", "Dress", "Rp1.500.000", "Rp1.500.000", "Rp0", "Rp0", "12", "12"],
  // qa_creator_dua — 100% via agency link
  ["qa_creator_dua", "128.400", "P1", "Serum Wajah Glow", SHOP_DEAL, "QA Shop Deal Aktif", "Beauty", "Skincare", "Rp1.000.000", "Rp1.000.000", "Rp0", "Rp0", "8", "8"],
  // qa_creator_dua — shop deal KADALUARSA tapi masih transaksi → alert + peluang re-deal
  ["qa_creator_dua", "128.400", "P6", "Wajan Anti Lengket", SHOP_EXPIRED, "QA Shop Deal Kadaluarsa", "Home", "Kitchen", "Rp2.500.000", "Rp0", "Rp2.500.000", "Rp0", "15", "15"],
  // qa_creator_tiga — hanya shop tanpa deal → peluang BD (Rupiah gaya koma diuji di sini)
  ["qa_creator_tiga", "58.120", "P7", "Botol Minum 1L", SHOP_NON_DEAL, "QA Shop Peluang BD", "Home", "Drinkware", "Rp1,750,000", "Rp0", "Rp1,750,000", "Rp0", "9", "9"],
  ["qa_creator_tiga", "58.120", "P8", "Tumbler Stainless", SHOP_NON_DEAL, "QA Shop Peluang BD", "Home", "Drinkware", "Rp1,250,000", "Rp0", "Rp1,250,000", "Rp0", "7", "7"],
];

const TAP_HEADER = [
  "Tanggal", "Creator name", "ID Produk", "Nama Produk", "ID Toko", "Nama Toko",
  "Kategori Level 2", "GMV Afiliasi", "GMV Live Afiliasi", "GMV Video Afiliasi", "Pesanan", "Produk Terjual",
];

/** [creator, productId, productName, shopId, shopName, cat2, gmv, liveGmv, videoGmv, orders, items] */
const TAP_ROWS: Array<[string, string, string, string, string, string, string, string, string, string, string]> = [
  // P1 tertangkap sebagian (2,5jt dari 3jt) → bocor 500rb
  ["qa_creator_satu", "P1", "Serum Wajah Glow", SHOP_DEAL, "QA Shop Deal Aktif", "Skincare", "Rp2.500.000", "Rp1.800.000", "Rp700.000", "25", "25"],
  // P2 TIDAK ADA di TAP → bocor total 2jt
  // P4 over-report (1,5jt > MCN 1jt): basis produk tetap 0 untuk P4, TAPI di basis shop
  // surplus ini menutupi sebagian bocor P1/P2 → dua angka jadi berbeda (transisi artifak)
  ["qa_creator_satu", "P4", "Toner Hydrating", SHOP_DEAL, "QA Shop Deal Aktif", "Skincare", "Rp1.500.000", "Rp0", "Rp1.500.000", "12", "12"],
  ["qa_creator_satu", "P5", "Dress Casual", SHOP_NO_DEAL_END, "QA Shop Tanpa Deal End", "Dress", "Rp1.500.000", "Rp1.500.000", "Rp0", "12", "12"],
  ["qa_creator_dua", "P1", "Serum Wajah Glow", SHOP_DEAL, "QA Shop Deal Aktif", "Skincare", "Rp1.000.000", "Rp1.000.000", "Rp0", "8", "8"],
];

const MASTER_SHOPS: Array<[string, string, string]> = [
  [SHOP_DEAL, "QA Shop Deal Aktif", "Skincare"],
  [SHOP_EXPIRED, "QA Shop Deal Kadaluarsa", "Kitchen"],
  [SHOP_NO_DEAL_END, "QA Shop Tanpa Deal End", "Dress"],
];

/** Menulis satu workbook 1-sheet; semua sel ditulis sebagai TEKS supaya Shop ID 19 digit tidak jadi notasi ilmiah. */
function writeWorkbook(aoa: unknown[][], sheetName: string, outPath: string): void {
  const ws = XLSX.utils.aoa_to_sheet(
    aoa.map((row) => row.map((v) => ({ t: "s", v: String(v ?? "") }))) as unknown as unknown[][]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(outPath, buf);
}

function main(): void {
  const outDir = process.argv[2] ?? "./sample-data";
  mkdirSync(outDir, { recursive: true });

  // Baris "Summary" pertama seperti export asli — harus di-SKIP parser (CLAUDE.md #7).
  const mcnAoa: unknown[][] = [
    MCN_HEADER,
    ["Summary", "-", "", "", "", "", "", "", "", "Rp14.000.000", "Rp6.300.000", "Rp7.700.000", "Rp200.000", "131", "131"],
    ...MCN_ROWS.map((r) => [PERIOD, ...r]),
  ];
  const tapAoa: unknown[][] = [TAP_HEADER, ...TAP_ROWS.map((r) => [PERIOD, ...r])];
  const masterAoa: unknown[][] = [
    ["MASTER ALL COOPERATING SHOPS — export mingguan platform"],
    [],
    ["Shop ID", "Shop Name", "Level 2 Categories (unique)"],
    ...MASTER_SHOPS,
  ];

  const mcnPath = join(outDir, `sample_mcn_${WEEK_START}.xlsx`);
  const tapPath = join(outDir, `sample_tap_${WEEK_START}.xlsx`);
  const masterPath = join(outDir, "sample_master_shop.xlsx");

  writeWorkbook(mcnAoa, "Custom report", mcnPath);
  writeWorkbook(tapAoa, "Custom report", tapPath);
  writeWorkbook(masterAoa, "Master", masterPath);

  console.log("File contoh QA analisa kebocoran dibuat:");
  console.log(`  MCN    : ${mcnPath} (${MCN_ROWS.length} baris + 1 Summary)`);
  console.log(`  TAP    : ${tapPath} (${TAP_ROWS.length} baris)`);
  console.log(`  Master : ${masterPath} (${MASTER_SHOPS.length} shop)`);
  console.log("");
  console.log(`Periode: ${WEEK_START} s/d ${WEEK_END} (W1 Juli 2026).`);
  console.log("Ekspektasi hasil analisa (ambang app_config m4.bocor_sebagian 0.10 / m4.bocor_total 0.50):");
  console.log("  qa_creator_satu : bocor basis PRODUK Rp2.500.000 (P1 500rb + P2 2jt), basis SHOP Rp2.000.000");
  console.log("                    → status bocor_sebagian (rasio 2,5jt / 7,5jt GMV shop ber-deal = 33,3%)");
  console.log("  qa_creator_dua  : bocor Rp0 di shop ber-deal → via_agency; Rp2.500.000 masuk peluang BD");
  console.log("                    (shop deal kadaluarsa) + alert deal_expired");
  console.log("  qa_creator_tiga : tidak ada GMV di shop ber-deal → belum_ada_link, peluang BD Rp3.000.000");
  console.log("  Lead BD         : 2 shop (QA Shop Peluang BD 3jt, QA Shop Deal Kadaluarsa 2,5jt)");
}

main();
