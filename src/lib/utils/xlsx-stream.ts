import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync, strFromU8 } from "fflate";
import * as XLSX from "xlsx";

/**
 * Streaming reader for the FIRST worksheet of a large .xlsx file.
 *
 * Why: SheetJS (`XLSX.read`) inflates the whole worksheet XML into ONE JavaScript
 * string. TikTok custom-report exports now reach 560–800MB of worksheet XML
 * (MCN ±360k rows, TAP 500k rows) — past V8's max string length (~512MB) — and
 * SheetJS then silently returns an EMPTY sheet: the MCN upload fails as "file
 * kosong" and, worse, the TAP upload "succeeds" with 0 rows (leak analysis
 * skipped without anyone noticing). This reader inflates the worksheet entry in
 * small chunks and scans `<row>` elements incrementally, so no string ever holds
 * more than one chunk of XML.
 *
 * Output mirrors `XLSX.utils.sheet_to_json(ws, { raw: false, defval: "", range })`
 * as used by `parseSheet` (see sheet.ts): header row = absolute row index `skip`,
 * missing header cell → "__EMPTY" (duplicates → "_1", "_2", …), absent cells →
 * "", rows without any present cell skipped, numbers formatted with SheetJS's own
 * formatter (`XLSX.SSF.format`) using the cell's number format — so a file read
 * here yields the same strings as the SheetJS path. Only used above
 * `XLSX_STREAM_MIN_SHEET_BYTES`; smaller files keep the SheetJS path unchanged.
 */

/** Worksheet XML at/above this size is read by the streaming path. */
export const XLSX_STREAM_MIN_SHEET_BYTES = 64 * 1024 * 1024;

/** Compressed bytes pushed to the inflater per step — bounds every decoded chunk. */
const PUSH_BYTES = 256 * 1024;

export interface XlsxSheetLocation {
  /** Zip entry name of the first worksheet, e.g. "xl/worksheets/sheet2.xml". */
  sheetPath: string;
  /** Uncompressed size of that entry (from the zip directory), or null if unknown. */
  sheetBytes: number | null;
  sharedStringsPath: string | null;
  stylesPath: string | null;
}

const META_FILES = new Set(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml"]);

/** Attribute value by plain string search (hot path: called per cell, no RegExp). */
function attr(tag: string, name: string): string | null {
  const key = `${name}="`;
  let i = tag.indexOf(key);
  // Require a whitespace before the name so "t=" never matches inside "ht=".
  while (i > 0 && !/\s/.test(tag[i - 1])) i = tag.indexOf(key, i + 1);
  if (i <= 0) return null;
  const start = i + key.length;
  const end = tag.indexOf('"', start);
  return end < 0 ? null : tag.slice(start, end);
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  // Relative to xl/ (the folder holding workbook.xml); normalise "./" and "../".
  const parts = ["xl", ...target.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/**
 * Locate the first worksheet (workbook order, like `wb.SheetNames[0]`) without
 * inflating any worksheet. Returns null when the buffer is not a readable xlsx.
 */
export function locateFirstSheet(buf: Uint8Array): XlsxSheetLocation | null {
  const sizes = new Map<string, number>();
  let meta: Record<string, Uint8Array>;
  try {
    meta = unzipSync(buf, {
      filter: (f) => {
        sizes.set(f.name, f.originalSize);
        return META_FILES.has(f.name);
      },
    });
  } catch {
    return null;
  }
  const workbook = meta["xl/workbook.xml"];
  const rels = meta["xl/_rels/workbook.xml.rels"];
  if (!workbook || !rels) return null;

  const relTargets = new Map<string, { target: string; type: string }>();
  for (const m of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) relTargets.set(id, { target: resolveTarget(target), type: attr(m[0], "Type") ?? "" });
  }
  const firstSheet = /<sheet\b[^>]*>/.exec(strFromU8(workbook));
  const rid = firstSheet ? attr(firstSheet[0], "r:id") : null;
  const sheetPath = rid ? relTargets.get(rid)?.target : undefined;
  if (!sheetPath) return null;

  const byType = (suffix: string) => {
    for (const r of relTargets.values()) if (r.type.endsWith(suffix)) return r.target;
    return null;
  };
  const sharedStringsPath = byType("/sharedStrings") ?? (sizes.has("xl/sharedStrings.xml") ? "xl/sharedStrings.xml" : null);
  const stylesPath = byType("/styles") ?? (sizes.has("xl/styles.xml") ? "xl/styles.xml" : null);
  return { sheetPath, sheetBytes: sizes.get(sheetPath) ?? null, sharedStringsPath, stylesPath };
}

/** XML text → string (entities + OOXML `_xHHHH_` escapes), like SheetJS unescapexml. */
export function unescapeXml(s: string): string {
  if (s.indexOf("&") < 0 && s.indexOf("_x") < 0) return s;
  return s
    .replace(/&(?:lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-fA-F]+));/g, (m, dec, hex) => {
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" }[m] ?? m;
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Concatenated text of every `<t>` run in an `<si>`/`<is>` body, phonetic runs excluded. */
function richText(body: string): string {
  // Fast path for the common single run: "<t>text</t>" / '<t xml:space="preserve">…</t>'.
  if (body.startsWith("<t") && body.endsWith("</t>") && body.indexOf("<t", 2) < 0) {
    const open = body.indexOf(">");
    if (open > 0 && body[open - 1] !== "/") return unescapeXml(body.slice(open + 1, body.length - 4));
  }
  const noPhonetic = body.indexOf("<rPh") >= 0 ? body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") : body;
  let out = "";
  for (const m of noPhonetic.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ?? "";
  return unescapeXml(out);
}

/**
 * Inflate one zip entry in bounded chunks, handing decoded text to `onText`.
 * Pushing the archive in PUSH_BYTES slices keeps each inflated chunk small (fflate
 * emits output per push), so memory stays flat regardless of entry size.
 */
function streamEntryText(buf: Uint8Array, path: string, onText: (text: string) => void): boolean {
  const decoder = new TextDecoder("utf-8");
  let found = false;
  let failure: unknown = null;
  const uz = new Unzip((file) => {
    if (file.name !== path) return;
    found = true;
    file.ondata = (err, chunk, final) => {
      if (err) {
        failure = err;
        return;
      }
      const text = decoder.decode(chunk, { stream: !final });
      if (text) onText(text);
    };
    file.start();
  });
  uz.register(UnzipInflate);
  uz.register(UnzipPassThrough);
  for (let off = 0; off < buf.length; off += PUSH_BYTES) {
    uz.push(buf.subarray(off, Math.min(off + PUSH_BYTES, buf.length)), off + PUSH_BYTES >= buf.length);
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  }
  return found;
}

/** Calls `onElement(body)` for every complete `<tag …>…</tag>` streamed through `push`. */
function elementScanner(tag: string, onElement: (open: string, body: string) => void) {
  let carry = "";
  const close = `</${tag}>`;
  const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");
  return {
    push(text: string) {
      carry += text;
      const end = carry.lastIndexOf(close);
      if (end < 0) {
        // Self-closing elements only (rare) — flush them once the next open tag starts.
        return;
      }
      const cut = end + close.length;
      const ready = carry.slice(0, cut);
      carry = carry.slice(cut);
      re.lastIndex = 0;
      for (const m of ready.matchAll(re)) onElement(m[1] ?? "", m[2] ?? "");
    },
    flush() {
      for (const m of carry.matchAll(re)) onElement(m[1] ?? "", m[2] ?? "");
      carry = "";
    },
    /** Text seen before the first complete element (for <dimension>). */
    peek: () => carry,
  };
}

function readSharedStrings(buf: Uint8Array, path: string | null): string[] {
  const out: string[] = [];
  if (!path) return out;
  const scan = elementScanner("si", (_open, body) => out.push(richText(body)));
  streamEntryText(buf, path, (t) => scan.push(t));
  scan.flush();
  return out;
}

interface NumberFormats {
  /** cellXfs index → number format (code string for custom formats, id otherwise). */
  byStyle: (string | number)[];
}

function readNumberFormats(buf: Uint8Array, path: string | null): NumberFormats {
  if (!path) return { byStyle: [] };
  let xml = "";
  try {
    xml = strFromU8(unzipSync(buf, { filter: (f) => f.name === path })[path] ?? new Uint8Array());
  } catch {
    return { byStyle: [] };
  }
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = attr(m[0], "numFmtId");
    const code = attr(m[0], "formatCode");
    if (id != null && code != null) custom.set(Number(id), unescapeXml(code));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  const byStyle: (string | number)[] = [];
  if (xfs) {
    for (const m of xfs[1].matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attr(m[0], "numFmtId") ?? 0);
      byStyle.push(custom.get(id) ?? id);
    }
  }
  return { byStyle };
}

/** "AB" → 27 (0-based column index). */
function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function splitRef(ref: string): { col: number; row: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : null;
}

/** One present cell: formatted text + whether SheetJS would count it as a value. */
interface CellOut {
  col: number;
  text: string;
  hasValue: boolean;
}

/**
 * Stream every row of the first worksheet. `onRow(rowIndex0, cells)` receives
 * only rows that have at least one cell element; `cells` is ordered by column.
 */
export function streamFirstSheetRows(
  buf: Uint8Array,
  loc: XlsxSheetLocation,
  onRow: (row: number, cells: CellOut[]) => void,
  onDimension?: (d: { startCol: number; endCol: number | null }) => void
): { startCol: number; endCol: number | null } {
  const sst = readSharedStrings(buf, loc.sharedStringsPath);
  const fmts = readNumberFormats(buf, loc.stylesPath);
  let dimension: { startCol: number; endCol: number | null } | null = null;
  let nextRow = 0;

  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const scan = elementScanner("row", (open, body) => {
    const rAttr = attr(` ${open}`, "r");
    const row = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = row + 1;
    const cells: CellOut[] = [];
    let nextCol = 0;
    for (const m of body.matchAll(cellRe)) {
      const a = ` ${m[1] ?? ""}`;
      const inner = m[2] ?? "";
      const ref = attr(a, "r");
      const col = ref ? splitRef(ref)?.col ?? nextCol : nextCol;
      nextCol = col + 1;
      const t = attr(a, "t") ?? "n";
      const vOpen = inner.indexOf("<v");
      const vStart = vOpen < 0 ? -1 : inner.indexOf(">", vOpen) + 1;
      const v = vOpen < 0 || inner[vStart - 2] === "/" ? undefined : inner.slice(vStart, inner.indexOf("</v>", vStart));
      let text = "";
      let hasValue = true;
      switch (t) {
        case "inlineStr":
          {
            const isOpen = inner.indexOf("<is");
            const isStart = isOpen < 0 ? -1 : inner.indexOf(">", isOpen) + 1;
            const isEnd = inner.lastIndexOf("</is>");
            text = isOpen < 0 || isEnd < isStart ? "" : richText(inner.slice(isStart, isEnd));
          }
          break;
        case "s":
          if (v == null) hasValue = false;
          else text = sst[Number(v)] ?? "";
          break;
        case "str":
        case "d":
          if (v == null) hasValue = false;
          else text = unescapeXml(v);
          break;
        case "b":
          if (v == null) hasValue = false;
          else text = v === "1" || v.toLowerCase() === "true" ? "TRUE" : "FALSE";
          break;
        case "e":
          // sheet_to_json maps error cells to defval and does not count them as values.
          hasValue = false;
          break;
        default: {
          if (v == null || v === "") {
            hasValue = false;
            break;
          }
          const num = Number(v);
          const style = Number(attr(a, "s") ?? 0);
          const fmt = fmts.byStyle[style] ?? 0;
          try {
            text = Number.isFinite(num) ? XLSX.SSF.format(fmt, num) : v;
          } catch {
            text = String(num);
          }
        }
      }
      cells.push({ col, text, hasValue });
    }
    onRow(row, cells);
  });

  const found = streamEntryText(buf, loc.sheetPath, (text) => {
    if (!dimension) {
      const pre = scan.peek() + text;
      const dim = /<dimension\b[^>]*\bref="([^"]+)"/.exec(pre);
      if (dim || pre.indexOf("<sheetData") >= 0) {
        const [s, e] = (dim?.[1] ?? "A1").split(":");
        const start = splitRef(s);
        const end = e ? splitRef(e) : null;
        dimension = { startCol: start?.col ?? 0, endCol: end ? end.col : null };
        onDimension?.(dimension);
      }
    }
    scan.push(text);
  });
  if (!found) throw new Error(`Sheet "${loc.sheetPath}" tidak ditemukan di file Excel`);
  scan.flush();
  return dimension ?? { startCol: 0, endCol: null };
}

/**
 * Rows of the first worksheet as `Record<key, value>`, handed to `onRecord` one
 * by one (never collected here: a 500k-row export kept as records costs GBs).
 *
 * Header text is de-duplicated exactly like SheetJS (raw text, "_1"/"_2"
 * suffixes) and then mapped once per column through `keyOf` (parseSheet passes
 * `normalizeHeader`), so the per-row work is plain property assignment — calling
 * the normaliser per cell (16M times for a 500k-row TAP export) was the slow part.
 * Values are trimmed, matching sheetToRows.
 *
 * `headerOk(keys)` picks the header row exactly like parseSheet's skip loop: the
 * first `skip` (0…maxSkip) whose mapped header keys pass AND that is followed by
 * at least one non-empty row. `headerOk = null` → skip 0 unconditionally (the
 * parseSheet behaviour without required headers). Returns null (and emits nothing)
 * when no skip qualifies.
 */
export function streamLargeSheetRecords(
  buf: Uint8Array,
  loc: XlsxSheetLocation,
  maxSkip: number,
  headerOk: ((keys: string[]) => boolean) | null,
  keyOf: (header: string) => string,
  onRecord: (record: Record<string, string>) => void
): { skip: number } | null {
  type RawRow = { row: number; cells: CellOut[] };
  const early: RawRow[] = [];
  let decided = false;
  let failed = false;
  let skip = -1;
  /** Final property key per column index (undefined outside the header extent). */
  let keys: (string | undefined)[] = [];
  let dims = { startCol: 0, endCol: null as number | null };

  const buildKeys = (headerRow: RawRow | undefined, extent: number) => {
    const out: string[] = [];
    const seen: Record<string, number> = {};
    const byCol = new Map((headerRow?.cells ?? []).map((c) => [c.col, c.text]));
    for (let c = dims.startCol; c <= extent; c++) {
      const v = byCol.get(c) ?? "__EMPTY";
      let key = v;
      let counter = seen[v] || 0;
      if (!counter) seen[v] = 1;
      else {
        do key = `${v}_${counter++}`;
        while (seen[key]);
        seen[v] = counter;
        seen[key] = 1;
      }
      out[c] = keyOf(key);
    }
    return out;
  };

  const emit = (r: RawRow) => {
    let any = false;
    for (const c of r.cells) if (c.hasValue) { any = true; break; }
    if (!any) return;
    const rec: Record<string, string> = {};
    // Pre-fill in column order: same key order (and hidden class) for every row.
    for (let c = dims.startCol; c < keys.length; c++) {
      const k = keys[c];
      if (k != null) rec[k] = "";
    }
    for (const cell of r.cells) {
      if (cell.col < dims.startCol) continue;
      let key = keys[cell.col];
      if (key == null) {
        // Column beyond the header/dimension extent: SheetJS would have widened the
        // range and keyed it "__EMPTY_n" — keep the value under the same kind of key.
        keys = buildKeys(early.find((e) => e.row === skip), Math.max(keys.length - 1, cell.col));
        key = keys[cell.col]!;
      }
      rec[key] = cell.hasValue ? cell.text.trim() : "";
    }
    onRecord(rec);
  };

  const decide = () => {
    decided = true;
    let extent = dims.endCol ?? -1;
    for (const e of early) for (const c of e.cells) if (c.col > extent) extent = c.col;
    for (let s = 0; s <= maxSkip; s++) {
      const candidate = buildKeys(early.find((e) => e.row === s), extent);
      const ok = headerOk == null
        ? true
        : early.some((e) => e.row > s && e.cells.some((c) => c.hasValue)) &&
          headerOk(candidate.filter((k): k is string => k != null));
      if (ok) {
        skip = s;
        keys = candidate;
        for (const e of early) if (e.row > s) emit(e);
        return;
      }
    }
    failed = true;
  };

  streamFirstSheetRows(
    buf,
    loc,
    (row, cells) => {
      if (failed) return;
      if (!decided) {
        early.push({ row, cells });
        // The header decision needs every row up to maxSkip plus one row after it.
        if (row > maxSkip + 1) decide();
        return;
      }
      emit({ row, cells });
    },
    (d) => {
      dims = d;
    }
  );
  if (!decided) decide();
  return failed ? null : { skip };
}
