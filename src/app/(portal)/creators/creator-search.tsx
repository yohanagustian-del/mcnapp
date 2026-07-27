"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Jeda sebelum query dikirim ke server. Cukup pendek untuk terasa real-time,
 * cukup panjang untuk tidak menembak query per-keystroke (2.600 kreator).
 */
const DEBOUNCE_MS = 300;

/**
 * Search kreator real-time. Filter dijalankan di SERVER (ILIKE lintas seluruh
 * tabel creators, bukan hanya baris yang ter-load) — pola sama seperti /deals
 * dan /products. Bedanya: tanpa tombol cari, URL di-update otomatis saat user
 * mengetik, jadi hasil ikut ter-refresh sendiri.
 */
export function CreatorSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [term, setTerm] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  const activeQuery = searchParams.get("q") ?? "";

  useEffect(() => {
    // Sudah sinkron dengan URL (termasuk saat render pertama) → tidak perlu navigasi.
    if (term.trim() === activeQuery) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (term.trim()) params.set("q", term.trim());
      else params.delete("q");
      // Halaman 1 lagi tiap ganti kata kunci; pertahankan filter lain (expiring).
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [term, activeQuery, pathname, router, searchParams]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-96">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Cari nama / username / no HP / UID / domisili…"
          aria-label="Cari kreator"
          className="w-full rounded-md border border-slate-300 px-3 py-2 pr-16 text-sm"
        />
        {term && (
          <button
            type="button"
            onClick={() => setTerm("")}
            aria-label="Hapus pencarian"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        )}
      </div>
      {isPending && <span className="text-xs text-slate-400">mencari…</span>}
    </div>
  );
}
