import type { SupabaseClient } from "@supabase/supabase-js";
import { BIZDEV_ROLES } from "@/lib/rbac-constants";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import { diffHandlers, validateHandlerIds } from "./bizdev-handler-spec";
import type { AuditEntry } from "@/lib/audit";

/**
 * Data access brand_bizdev_handlers (migrasi 0087, REVISI_BIZDEV T5). Satu tempat
 * dipakai tombol per baris (Deal Brand), Registrasi Deal, upload Excel, dan pembaca
 * (tabel Shop, detail deal, summary BizDev).
 */

export interface BizdevMember {
  id: string;
  name: string;
}

/** Anggota tim aktif ber-role BizDev (BIZDEV_ROLES) — satu-satunya yang boleh jadi handler. */
export async function loadBizdevMembers(client: SupabaseClient): Promise<BizdevMember[]> {
  const { data, error } = await client
    .from("team_members")
    .select("id, name")
    .in("role", BIZDEV_ROLES)
    .eq("active", true)
    .order("name");
  if (error) throw new Error(`Gagal memuat anggota BizDev: ${error.message}`);
  return (data ?? []).map((m) => ({ id: String(m.id), name: String(m.name) }));
}

export interface HandlerIndex {
  /** shop_key → handler (urut nama). */
  byShopKey: Map<string, BizdevMember[]>;
  /** true = tabel belum ada (migrasi 0087 belum di-apply). */
  missing: boolean;
}

/**
 * Semua handler (tabel kecil: ≤ 2 baris per brand). Nama di-join dari team_members
 * yang sama. Tabel belum ada → `missing`, bukan crash.
 */
export async function loadHandlerIndex(client: SupabaseClient, shopKeys?: string[]): Promise<HandlerIndex> {
  let q = client.from("brand_bizdev_handlers").select("shop_key, member_id, team_members!brand_bizdev_handlers_member_id_fkey(name)");
  if (shopKeys) {
    if (shopKeys.length === 0) return { byShopKey: new Map(), missing: false };
    q = q.in("shop_key", shopKeys);
  }
  const { data, error } = await q;
  if (error) {
    if (isMissingRelationError(error)) return { byShopKey: new Map(), missing: true };
    throw new Error(`Gagal memuat BizDev handler: ${error.message}`);
  }
  const byShopKey = new Map<string, BizdevMember[]>();
  for (const r of data ?? []) {
    const name = (r.team_members as unknown as { name?: string } | null)?.name ?? "—";
    const list = byShopKey.get(r.shop_key as string) ?? [];
    list.push({ id: String(r.member_id), name });
    byShopKey.set(r.shop_key as string, list);
  }
  for (const list of byShopKey.values()) list.sort((a, b) => a.name.localeCompare(b.name, "id"));
  return { byShopKey, missing: false };
}

export interface SyncResult {
  added: string[];
  removed: string[];
}

/**
 * Tulis keadaan akhir handler satu brand sebagai SELISIH (hapus yang keluar, tambah
 * yang masuk) — service role. `nextIds` harus sudah tervalidasi sebagai anggota
 * BizDev oleh pemanggil. Mengembalikan entri audit (type auto: menugaskan PIC tidak
 * merugikan perusahaan, CLAUDE.md #2) supaya pemanggil massal bisa menulisnya sekali.
 */
export async function syncShopHandlers(
  admin: SupabaseClient,
  actorId: string,
  shopKey: string,
  nextIds: string[],
  source: "row_edit" | "register" | "upload"
): Promise<{ result: SyncResult; audit: AuditEntry | null }> {
  const invalid = validateHandlerIds(nextIds);
  if (invalid) throw new Error(invalid);

  const { data: cur, error } = await admin
    .from("brand_bizdev_handlers").select("member_id").eq("shop_key", shopKey);
  if (error) {
    if (isMissingRelationError(error)) throw new Error(MIGRATION_0087_MISSING);
    throw new Error(`Gagal membaca BizDev handler: ${error.message}`);
  }
  const current = (cur ?? []).map((r) => String(r.member_id));
  const { add, remove } = diffHandlers(current, nextIds);
  if (add.length === 0 && remove.length === 0) return { result: { added: [], removed: [] }, audit: null };

  // Hapus dulu: trigger maks-2 menghitung baris yang ada saat insert.
  if (remove.length > 0) {
    const { error: delErr } = await admin
      .from("brand_bizdev_handlers").delete().eq("shop_key", shopKey).in("member_id", remove);
    if (delErr) throw new Error(`Gagal menghapus BizDev handler: ${delErr.message}`);
  }
  if (add.length > 0) {
    const { error: insErr } = await admin
      .from("brand_bizdev_handlers")
      .insert(add.map((member_id) => ({ shop_key: shopKey, member_id, assigned_by: actorId })));
    if (insErr) throw new Error(`Gagal menyimpan BizDev handler: ${insErr.message}`);
  }
  return {
    result: { added: add, removed: remove },
    audit: {
      actorId,
      action: "deals.bizdev_handler",
      entityType: "brand_bizdev_handlers",
      entityId: shopKey,
      before: { member_ids: current },
      after: { member_ids: nextIds, source },
      type: "auto",
    },
  };
}

/** Isian "BizDev handler" Registrasi Deal (name bizdev_handler_1/_2) → id unik, tanpa kosong. */
export function handlerIdsFromForm(formData: FormData): string[] {
  const ids: string[] = [];
  for (const key of ["bizdev_handler_1", "bizdev_handler_2"]) {
    const v = String(formData.get(key) ?? "").trim();
    if (v && !ids.includes(v)) ids.push(v);
  }
  return ids;
}

/**
 * Registrasi Deal: tugaskan BizDev ke brand yang baru didaftarkan. Konservatif —
 * kalau brand itu SUDAH punya handler (kartu produk baru di shop lama), assignment
 * lama TIDAK ditimpa; ubahnya lewat tombol BizDev di tab Deal Brand. Tidak pernah
 * menggagalkan registrasi: kegagalan dikembalikan sebagai catatan untuk pesan sukses.
 */
export async function assignHandlersOnRegister(
  admin: SupabaseClient,
  actorId: string,
  shopKey: string | null,
  ids: string[]
): Promise<{ note: string | null; audit: AuditEntry | null }> {
  if (ids.length === 0) return { note: null, audit: null };
  if (!shopKey) return { note: "BizDev handler tidak disimpan: shop belum dikenali.", audit: null };
  try {
    const members = await loadBizdevMembers(admin);
    const allowed = new Set(members.map((m) => m.id));
    if (ids.some((id) => !allowed.has(id))) {
      return { note: "BizDev handler tidak disimpan: hanya anggota aktif ber-role BizDev yang bisa dipilih.", audit: null };
    }
    const { data: cur, error } = await admin
      .from("brand_bizdev_handlers").select("member_id").eq("shop_key", shopKey);
    if (error) {
      if (isMissingRelationError(error)) return { note: `BizDev handler belum disimpan — ${MIGRATION_0087_MISSING}`, audit: null };
      throw new Error(error.message);
    }
    if ((cur ?? []).length > 0) {
      return { note: "Brand ini sudah punya BizDev handler — tidak diubah (ubah lewat tombol BizDev di tab Deal Brand).", audit: null };
    }
    const { audit } = await syncShopHandlers(admin, actorId, shopKey, ids, "register");
    return { note: null, audit };
  } catch (e) {
    return { note: `BizDev handler gagal disimpan: ${e instanceof Error ? e.message : String(e)}`, audit: null };
  }
}
