/**
 * Supabase tiruan in-memory untuk tes end-to-end upload sesi live.
 *
 * Bukan pengganti database sungguhan: yang diuji di sini adalah RANTAI KODE
 * APLIKASI (nama file → deteksi jenis → parse → verifikasi V1–V7 → simpan →
 * bentuk report), bukan Postgres. Karena itu ia hanya mendukung operasi yang
 * benar-benar dipakai jalur itu, dan SENGAJA melempar untuk operator yang belum
 * didukung — supaya tes gagal berisik saat kode produksi memakai bentuk query
 * baru, bukan diam-diam mengembalikan nol baris (yang akan terbaca seperti
 * "tidak ada konflik" pada V4 dan meloloskan bug).
 */

type Row = Record<string, unknown>;

interface Filter {
  apply: (row: Row) => boolean;
}

const eqValue = (a: unknown, b: unknown): boolean => {
  if (a === null || a === undefined) return b === null || b === undefined;
  return String(a) === String(b);
};

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private limitCount: number | null = null;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;

  constructor(private readonly rows: Row[]) {}

  select(): this { return this; }
  order(): this { return this; }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  /** Paginasi `fetchAll()` (from..to inklusif, sama seperti PostgREST). */
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ apply: (r) => eqValue(r[col], value) });
    return this;
  }

  neq(col: string, value: unknown): this {
    this.filters.push({ apply: (r) => !eqValue(r[col], value) });
    return this;
  }

  in(col: string, values: unknown[]): this {
    this.filters.push({ apply: (r) => values.some((v) => eqValue(r[col], v)) });
    return this;
  }

  gte(col: string, value: string): this {
    this.filters.push({ apply: (r) => String(r[col]) >= value });
    return this;
  }

  lt(col: string, value: string): this {
    this.filters.push({ apply: (r) => String(r[col]) < value });
    return this;
  }

  gt(col: string, value: string): this {
    this.filters.push({ apply: (r) => String(r[col]) > value });
    return this;
  }

  lte(col: string, value: string): this {
    this.filters.push({ apply: (r) => String(r[col]) <= value });
    return this;
  }

  /** Hanya `col.is.null` / `col.is.not.null` — bentuk yang dipakai build.ts. */
  not(col: string, op: string, value: unknown): this {
    if (op !== "is" || value !== null) throw new Error(`fake-supabase: not(${op}) belum didukung`);
    this.filters.push({ apply: (r) => r[col] !== null && r[col] !== undefined });
    return this;
  }

  /** Hanya `col.eq.value` yang dipisah koma (OR) — bentuk V4 di live-ingest.ts. */
  or(expr: string): this {
    const clauses = expr.split(",").map((part) => {
      const m = /^([a-z0-9_]+)\.eq\.(.*)$/i.exec(part.trim());
      if (!m) throw new Error(`fake-supabase: klausa or() belum didukung: ${part}`);
      return { col: m[1], value: m[2] };
    });
    this.filters.push({ apply: (r) => clauses.some((c) => eqValue(r[c.col], c.value)) });
    return this;
  }

  private result(): Row[] {
    const matched = this.rows.filter((r) => this.filters.every((f) => f.apply(r)));
    const ranged =
      this.rangeFrom === null || this.rangeTo === null
        ? matched
        : matched.slice(this.rangeFrom, this.rangeTo + 1);
    return this.limitCount === null ? ranged : ranged.slice(0, this.limitCount);
  }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const rows = this.result();
    if (rows.length !== 1) return { data: null, error: { message: `expected 1 row, got ${rows.length}` } };
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: this.result()[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.result(), error: null }).then(onfulfilled, onrejected);
  }
}

class InsertQuery implements PromiseLike<{ data: null; error: null }> {
  constructor(private readonly inserted: Row[]) {}
  select(): this { return this; }
  async single(): Promise<{ data: Row | null; error: null }> {
    return { data: this.inserted[0] ?? null, error: null };
  }
  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
  }
}

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Baris di satu tabel (helper baca untuk assertion). */
  rows: (table: string) => Row[];
  client: import("@supabase/supabase-js").SupabaseClient;
}

/**
 * Tabel yang punya `id` bigserial diberi id berurut saat insert — sama seperti
 * Postgres, karena `persistLiveSessions` memakai id itu untuk menautkan produk
 * & interval ke sesinya.
 */
const SERIAL_TABLES = new Set([
  "project_live_sessions",
  "project_live_session_products",
  "project_live_intervals",
  "creator_reports",
]);

export function createFakeSupabase(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const nextId: Record<string, number> = {};

  const client = {
    from(table: string) {
      tables[table] ??= [];
      return {
        select: () => new Query(tables[table]),
        insert: (payload: Row | Row[]) => {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => {
            const row = { ...r };
            if (SERIAL_TABLES.has(table)) {
              nextId[table] = (nextId[table] ?? 0) + 1;
              row.id = nextId[table];
            }
            return row;
          });
          tables[table].push(...rows);
          return new InsertQuery(rows);
        },
        update: (patch: Row) => {
          const q = new Query(tables[table]);
          // Update tidak dipakai jalur upload; disediakan agar pemanggil lain
          // gagal jelas alih-alih "undefined is not a function".
          void patch;
          return q;
        },
      };
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;

  return { tables, rows: (t) => tables[t] ?? [], client };
}
