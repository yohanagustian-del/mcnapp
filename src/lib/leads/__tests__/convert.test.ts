import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canEditLead,
  conversionNote,
  convertLeadOnRegister,
  formatLeadContacts,
  isLeadConverted,
  leadPlatform,
  matchBizdevNames,
  parseDealPlatform,
  type LeadRef,
} from "../convert";

/** Fake brand_leads: select().eq().maybeSingle() + update().eq(). */
function fakeLeads(rows: LeadRef[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      if (table !== "brand_leads") throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(_c: string, id: string) {
              return { maybeSingle: async () => ({ data: rows.find((r) => r.id === id) ?? null, error: null }) };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_c: string, id: string) => {
              updates.push({ id, patch });
              const row = rows.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, updates };
}

const lead = (over: Partial<LeadRef> = {}): LeadRef => ({
  id: "LEAD-1", created_by: "bd1", converted_deal_id: null, status: "nego", notes: null, ...over,
});

describe("canEditLead (gerbang sama dengan assertLeadEditable)", () => {
  it("pembuat boleh, BD lain tidak, bizdev_lead & management selalu boleh", () => {
    expect(canEditLead({ id: "bd1", role: "bizdev" }, lead(), true)).toBe(true);
    expect(canEditLead({ id: "bd2", role: "bizdev" }, lead(), true)).toBe(false);
    expect(canEditLead({ id: "x", role: "bizdev_lead" }, lead(), true)).toBe(true);
    expect(canEditLead({ id: "x", role: "director" }, lead(), true)).toBe(true);
    expect(canEditLead({ id: "bd1", role: "bizdev" }, lead(), false)).toBe(false);
  });
});

describe("prefill dari lead", () => {
  it("platform hanya bila tepat satu", () => {
    expect(leadPlatform(["shopee"])).toBe("shopee");
    expect(leadPlatform(["tiktok_shop"])).toBe("tiktok");
    expect(leadPlatform(["shopee", "tiktok_shop"])).toBeNull();
    expect(leadPlatform(null)).toBeNull();
  });

  it("bizdev_names teks bebas → id anggota BizDev yang cocok persis, maks 2, tanpa tebakan", () => {
    const members = [{ id: "a", name: "Rina" }, { id: "b", name: "Budi Santoso" }, { id: "c", name: "Tono" }];
    expect(matchBizdevNames("rina, Budi Santoso", members)).toEqual(["a", "b"]);
    expect(matchBizdevNames("Rina & Tono & Budi Santoso", members)).toEqual(["a", "c"]);
    expect(matchBizdevNames("Rina dan Budi", members)).toEqual(["a"]);
    expect(matchBizdevNames(null, members)).toEqual([]);
  });

  it("kontak PIC → satu baris; kosong → null", () => {
    expect(formatLeadContacts([{ lead_name: "Andi", phone: "0812", email: null }, { lead_name: null, phone: null, email: "x@y.id" }]))
      .toBe("Andi · 0812; x@y.id");
    expect(formatLeadContacts([{ lead_name: " ", phone: null, email: null }])).toBeNull();
  });

  it("parseDealPlatform menolak nilai liar", () => {
    expect(parseDealPlatform("shopee")).toBe("shopee");
    expect(parseDealPlatform("lazada")).toBeNull();
    expect(parseDealPlatform(null)).toBeNull();
  });
});

describe("convertLeadOnRegister", () => {
  const today = "2026-10-13";

  it("jalur deal shop → converted_deal_id + status deal + audit lead.convert", async () => {
    const db = fakeLeads([lead()]);
    const r = await convertLeadOnRegister(db.client, { id: "bd1", role: "bizdev" }, true, "LEAD-1", { kind: "deal", dealId: "DEAL-9" }, today);
    expect(db.updates[0].patch).toMatchObject({ converted_deal_id: "DEAL-9", status: "deal" });
    expect(db.updates[0].patch.notes).toBeUndefined();
    expect(r.audit).toMatchObject({ action: "lead.convert", entityId: "LEAD-1", type: "auto" });
  });

  it("jalur kartu produk → status deal, converted_deal_id tetap null, kunci kartu ditambahkan ke notes", async () => {
    const db = fakeLeads([lead({ notes: "catatan lama" })]);
    const target = { kind: "card" as const, cardKey: "C1|P1", shopKey: "tiktok:Skintific" };
    await convertLeadOnRegister(db.client, { id: "bd1", role: "bizdev" }, true, "LEAD-1", target, today);
    const patch = db.updates[0].patch;
    expect(patch.status).toBe("deal");
    expect("converted_deal_id" in patch).toBe(false);
    expect(patch.notes).toBe(`catatan lama\n${conversionNote(target, today)}`);
  });

  it("lead sudah terkonversi / bukan pemilik / tidak ada → tidak diubah, hanya catatan", async () => {
    const done = fakeLeads([lead({ converted_deal_id: "DEAL-1", status: "deal" })]);
    expect((await convertLeadOnRegister(done.client, { id: "bd1", role: "bizdev" }, true, "LEAD-1", { kind: "deal", dealId: "DEAL-2" }, today)).note)
      .toMatch(/sudah berstatus deal/);
    expect(done.updates).toHaveLength(0);

    const other = fakeLeads([lead()]);
    expect((await convertLeadOnRegister(other.client, { id: "bd2", role: "bizdev" }, true, "LEAD-1", { kind: "deal", dealId: "D" }, today)).note)
      .toMatch(/hanya pembuat lead/);
    expect(other.updates).toHaveLength(0);

    const none = fakeLeads([]);
    expect((await convertLeadOnRegister(none.client, { id: "bd1", role: "bizdev" }, true, "LEAD-X", { kind: "deal", dealId: "D" }, today)).note)
      .toMatch(/tidak ditemukan/);
  });

  it("isLeadConverted: deal_id ATAU status deal", () => {
    expect(isLeadConverted({ converted_deal_id: null, status: "deal" })).toBe(true);
    expect(isLeadConverted({ converted_deal_id: "D", status: "nego" })).toBe(true);
    expect(isLeadConverted({ converted_deal_id: null, status: "nego" })).toBe(false);
  });
});
