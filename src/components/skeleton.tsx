/**
 * Skeleton primitives for loading states.
 * Server component (no "use client") — used in loading.tsx files.
 */

export function SkeletonLine({ w }: { w?: string } = {}) {
  return (
    <div
      className={`h-4 animate-pulse rounded bg-slate-200 ${w ?? "w-40"}`}
      aria-hidden="true"
    />
  );
}

export function SkeletonTitle() {
  return (
    <div className="h-7 w-56 animate-pulse rounded bg-slate-200" aria-hidden="true" />
  );
}

export function SkeletonSubtitle() {
  return (
    <div className="h-4 w-72 animate-pulse rounded bg-slate-200" aria-hidden="true" />
  );
}

export function SkeletonCard({ rows = 2 }: { rows?: number } = {}) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-hidden="true"
    >
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonLine key={i} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number } = {}) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white p-4"
      aria-hidden="true"
    >
      <div className="space-y-3">
        {/* Header */}
        <div className="flex gap-2 pb-2 border-b border-slate-200">
          {Array.from({ length: cols }).map((_, i) => (
            <SkeletonLine key={`header-${i}`} w="w-20" />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={`row-${rowIdx}`} className="flex gap-2">
            {Array.from({ length: cols }).map((_, colIdx) => (
              <SkeletonLine key={`col-${colIdx}`} w="w-20" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonStatGrid({ n = 3 }: { n?: number } = {}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      aria-hidden="true"
    >
      {Array.from({ length: n }).map((_, i) => (
        <SkeletonCard key={i} rows={2} />
      ))}
    </div>
  );
}
