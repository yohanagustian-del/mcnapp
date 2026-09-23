"use client";

import { useState } from "react";
import type { MatchedProduct, ProductMatchResult } from "@/lib/product-match/engine";

const SEGMENT_LABELS: Record<string, string> = {
  low: "Low-ticket",
  entry: "Entry/mid-low",
  sweet: "Sweet spot",
  high: "High-ticket",
  premium: "Premium",
};

const rupiah = (n: number | null) => (n == null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);

function CopyProductIdButton({ productId }: { productId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(productId);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard API tidak tersedia (mis. non-HTTPS) — diamkan, bukan crash.
        }
      }}
      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
      title="Salin Product ID"
    >
      {copied ? "Tersalin ✓" : `${productId} ⧉`}
    </button>
  );
}

function ProductCard({ product, showCommission = true }: { product: MatchedProduct; showCommission?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-800">{product.productName ?? "(tanpa nama)"}</p>
        {product.sourceLabel && (
          <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700">
            {product.sourceLabel}
          </span>
        )}
      </div>
      {product.shopName && <p className="mt-0.5 text-xs text-slate-500">{product.shopName}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {product.aov != null && (
          <span>
            AOV {rupiah(product.aov)}
            {product.aovSource === "price" && <span className="text-slate-400"> (harga kartu)</span>}
          </span>
        )}
        {product.orders > 0 && <span>· {product.orders} order</span>}
        {showCommission && product.commissionPct != null && <span>· komisi {product.commissionPct}%</span>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <CopyProductIdButton productId={product.productId} />
        {product.productLink && (
          <a
            href={product.productLink}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Buka link →
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Tampilan hasil Creator Product Match — dipakai apa adanya oleh /matching,
 * CM Workspace, dan portal kreator (CLAUDE.md #4). `showCommission` dimatikan
 * di portal kreator (M9: komisi MEA/margin tidak pernah ditampilkan ke kreator
 * — di sini hanya komisi kreator yang ditampilkan, jadi aman ditampilkan bila
 * dibutuhkan; halaman portal memilih untuk menyembunyikannya demi kesederhanaan).
 */
export function ProductMatchView({
  result,
  showCommission = true,
}: {
  result: ProductMatchResult;
  showCommission?: boolean;
}) {
  if (result.categories.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Belum ada histori transaksi yang cukup dalam window berjalan.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <span className="font-medium text-slate-800">Profil Kreator:</span>
        <span>{result.summary.categoryCount} kategori</span>
        <span>· total GMV {rupiah(result.summary.totalGmv)}</span>
        <span>· {result.summary.totalOrders} order</span>
        {Object.entries(result.summary.segmentCounts).map(([seg, count]) => (
          <span key={seg} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-200">
            {SEGMENT_LABELS[seg] ?? seg}: {count}
          </span>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {result.categories.map((cat) => (
          <div key={cat.lvl2} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">{cat.lvl2}</h3>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">
                  {SEGMENT_LABELS[cat.segment] ?? cat.segment}
                </span>
                <span>GMV {rupiah(cat.gmv)}</span>
                <span>· {cat.orders} order</span>
                <span>· AOV {rupiah(cat.aov)}</span>
              </div>
            </div>

            {cat.products.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {cat.products.map((p) => (
                  <ProductCard key={`${p.source}-${p.productId}`} product={p} showCommission={showCommission} />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-400">
                Belum ada produk TAP/PX di kategori & segmen ini.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
