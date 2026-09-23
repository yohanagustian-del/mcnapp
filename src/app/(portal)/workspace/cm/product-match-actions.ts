"use server";

import { requireMember } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCreatorInScope } from "@/lib/schedule/scope";
import { buildCreatorProductMatch } from "@/lib/product-match/data";
import type { ProductMatchResult } from "@/lib/product-match/engine";

/**
 * CM Workspace "Produk Cocok per Kreator" — panggil engine yang sama dengan
 * /matching & /creators/[id] (CLAUDE.md #4), batch per klik (bukan per LLM —
 * ini deterministik, 0 token). Gerbang scope sama seperti Jadwal Live: CPM
 * hanya boleh melihat kreator yang dipegangnya sendiri.
 */
export async function loadCmProductMatch(creatorId: string): Promise<ProductMatchResult> {
  const member = await requireMember();
  const admin = createAdminClient();
  await assertCreatorInScope(admin, member, creatorId);
  return buildCreatorProductMatch(creatorId);
}
