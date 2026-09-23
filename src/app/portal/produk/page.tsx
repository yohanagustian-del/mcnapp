import { requireCreator } from "@/lib/m9/creator-auth";
import { buildCreatorProductMatch } from "@/lib/product-match/data";
import { ProductMatchView } from "@/components/product-match-view";

/**
 * Rekomendasi produk swalayan kreator (rencana §A.4) — Produk TAP ∪ PX
 * Exchange, engine yang sama dengan /matching & /creators/[id] (CLAUDE.md #4).
 * Komisi yang tampil selalu komisi KREATOR (lihat komentar ProductMatchView) —
 * tidak pernah komisi/margin MEA, karena field itu tidak pernah ada di engine.
 */
export default async function CreatorProductMatchPage() {
  const { creatorId } = await requireCreator();
  const result = await buildCreatorProductMatch(creatorId);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Produk Cocok Untukmu</h1>
        <p className="text-sm text-slate-500">
          Produk Deal TAP dan PX Exchange yang cocok dengan kategori & harga jual biasamu, dari
          histori transaksi mingguanmu (window berjalan). Diperbarui otomatis tiap upload data
          platform — bukan daftar tetap.
        </p>
      </header>
      <ProductMatchView result={result} />
    </div>
  );
}
