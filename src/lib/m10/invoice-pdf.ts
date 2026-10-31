// Pembuat PDF invoice ads (D-2026-10-31-6). Layout = PLACEHOLDER sampai template resmi
// dari Yohan masuk — ganti isi fungsi ini, bukan pemanggilnya. Deterministik, 0 LLM.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AdsInvoiceRow } from "./invoice-data";

const COMPANY = {
  name: "MCN MEA — PT MEA Agensi Digital",
  lines: ["Bandung, Jawa Barat", "mcnmea.gowebin.co.id"],
};

function idr(n: number): string {
  return `Rp${Math.round(n).toLocaleString("id-ID")}`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${d} ${months[Number(m) - 1] ?? m} ${y}`;
}

/** Hilangkan karakter di luar WinAnsi supaya font standar tidak melempar error. */
function safe(s: string): string {
  return s.replace(/[^\x20-\x7E -ÿ]/g, "?");
}

export interface InvoicePdfContext {
  invoice: AdsInvoiceRow;
  requestObjective: string | null;
  issuedByName: string | null;
}

export async function buildInvoicePdf(ctx: InvoicePdfContext): Promise<Uint8Array> {
  const { invoice } = ctx;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.id}`);
  doc.setAuthor(COMPANY.name);
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  let y = 800;

  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = rgb(0.1, 0.1, 0.12)) => {
    page.drawText(safe(s), { x, y, size, font: f, color });
  };
  const line = (yy: number) => page.drawLine({ start: { x: margin, y: yy }, end: { x: 595.28 - margin, y: yy }, thickness: 0.6, color: rgb(0.8, 0.8, 0.82) });

  // Header
  text(COMPANY.name, margin, 14, bold);
  y -= 16;
  for (const l of COMPANY.lines) { text(l, margin, 9, font, rgb(0.4, 0.4, 0.45)); y -= 12; }
  page.drawText("INVOICE", { x: 595.28 - margin - 90, y: 800, size: 22, font: bold, color: rgb(0.1, 0.1, 0.12) });
  page.drawText(safe(invoice.id), { x: 595.28 - margin - 90, y: 782, size: 11, font, color: rgb(0.3, 0.3, 0.35) });

  y -= 10;
  line(y);
  y -= 22;

  // Pihak
  text("Ditagihkan kepada", margin, 9, font, rgb(0.4, 0.4, 0.45));
  text("Tanggal terbit", 330, 9, font, rgb(0.4, 0.4, 0.45));
  text("Jatuh tempo", 450, 9, font, rgb(0.4, 0.4, 0.45));
  y -= 14;
  text(invoice.billToName, margin, 11, bold);
  text(fmtDate(invoice.issuedAt), 330, 10);
  text(fmtDate(invoice.dueDate), 450, 10);
  y -= 14;
  if (invoice.billToDetail) {
    for (const l of invoice.billToDetail.split(/\r?\n/).slice(0, 4)) { text(l, margin, 9, font, rgb(0.3, 0.3, 0.35)); y -= 12; }
  }
  y -= 10;
  text(`Status: ${invoice.status.toUpperCase()}${invoice.paidAt ? ` (dibayar ${fmtDate(invoice.paidAt)})` : ""}`, margin, 9, font, rgb(0.4, 0.4, 0.45));
  y -= 24;

  // Tabel
  line(y + 10);
  text("Deskripsi", margin, 9, bold);
  text("Jumlah", 595.28 - margin - 90, 9, bold);
  y -= 16;
  const desc = [
    `Ads support ${invoice.fundingType === "brand_budget" ? "brand" : "kreator"}` +
      (invoice.creatorName ? ` - ${invoice.creatorName}` : "") +
      (invoice.projectName ? ` - ${invoice.projectName}` : "") +
      (invoice.slotDate ? ` - live ${fmtDate(invoice.slotDate)}` : ""),
    ctx.requestObjective ? `(${ctx.requestObjective})` : null,
  ].filter((s): s is string => !!s);
  drawWrapped(page, font, desc.join(" "), margin, y, 360, 10);
  text(idr(invoice.dpp), 595.28 - margin - 90, 10);
  y -= 14 * Math.max(1, Math.ceil(desc.join(" ").length / 70));
  y -= 10;
  line(y + 4);
  y -= 14;
  text("DPP", 380, 10);
  text(idr(invoice.dpp), 595.28 - margin - 90, 10);
  y -= 14;
  text(`PPN ${(invoice.ppnRate * 100).toFixed(invoice.ppnRate * 100 % 1 === 0 ? 0 : 1)}%`, 380, 10);
  text(idr(invoice.ppn), 595.28 - margin - 90, 10);
  y -= 16;
  text("TOTAL", 380, 12, bold);
  text(idr(invoice.total), 595.28 - margin - 90, 12, bold);
  y -= 30;

  // Catatan
  if (invoice.note) {
    text("Catatan", margin, 9, font, rgb(0.4, 0.4, 0.45));
    y -= 12;
    drawWrapped(page, font, invoice.note, margin, y, 480, 9);
    y -= 40;
  }

  // Footer
  page.drawText(safe(`Diterbitkan dari MCN MEA Platform${ctx.issuedByName ? ` oleh ${ctx.issuedByName}` : ""}. Nomor invoice tidak dipakai ulang.`), {
    x: margin, y: 40, size: 8, font, color: rgb(0.5, 0.5, 0.55),
  });

  return doc.save();
}

function drawWrapped(page: PDFPage, font: PDFFont, s: string, x: number, y: number, maxWidth: number, size: number) {
  const words = safe(s).split(/\s+/);
  let lineText = "";
  let yy = y;
  for (const w of words) {
    const candidate = lineText ? `${lineText} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && lineText) {
      page.drawText(lineText, { x, y: yy, size, font });
      yy -= size + 4;
      lineText = w;
    } else {
      lineText = candidate;
    }
  }
  if (lineText) page.drawText(lineText, { x, y: yy, size, font });
}
