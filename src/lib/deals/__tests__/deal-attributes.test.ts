import { describe, expect, it } from "vitest";
import {
  changedAttributes,
  NEW_NICHE_VALUE,
  validateAdsSupport,
  validateDealAttributes,
  type DealAttributeInput,
} from "../deal-attributes";

const base: DealAttributeInput = {
  status: "", niche: "", newNiche: "", leadsType: "", supportTypes: [],
  priority: "", workingSheet: "", campaignOpsId: "",
};
const opts = {
  nicheOptions: ["Beauty & Personal Care", "Fashion"],
  leadsOptions: ["Internal TAP", "Scouting"],
  campaignOpsIds: new Set(["u-ops"]),
  canAddNiche: true,
};

describe("validateDealAttributes", () => {
  it("kosong semua → semua null", () => {
    const r = validateDealAttributes(base, opts);
    expect(r).toEqual({
      ok: true, addedNiche: null,
      record: { status: null, niche: null, leads_type: null, support_types: null, priority: null, working_sheet: null, campaign_ops_id: null },
    });
  });

  it("menormalkan status lama & mengurutkan support", () => {
    const r = validateDealAttributes({ ...base, status: "running", supportTypes: ["ads", "sample"], campaignOpsId: "u-ops" }, opts);
    expect(r.ok && r.record).toMatchObject({ status: "running_1st_month", support_types: ["sample", "ads"], campaign_ops_id: "u-ops" });
  });

  it("menolak nilai di luar daftar", () => {
    const r = validateDealAttributes(
      { ...base, status: "aktif", niche: "Lifestyle X", leadsType: "Lain", supportTypes: ["live"], campaignOpsId: "u-x" },
      opts
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors).sort()).toEqual(["campaign_ops_id", "leads_type", "niche", "status", "support_types"]);
  });

  it("Tambah niche baru: dicatat sebagai niche baru", () => {
    const r = validateDealAttributes({ ...base, niche: NEW_NICHE_VALUE, newNiche: "  Pet  Food " }, opts);
    expect(r).toMatchObject({ ok: true, addedNiche: "Pet Food", record: { niche: "Pet Food" } });
  });

  it("Tambah niche baru dengan ejaan yang sudah ada → pakai yang ada", () => {
    const r = validateDealAttributes({ ...base, niche: NEW_NICHE_VALUE, newNiche: "fashion" }, opts);
    expect(r).toMatchObject({ ok: true, addedNiche: null, record: { niche: "Fashion" } });
  });

  it("Tambah niche baru tanpa izin / tanpa nama ditolak", () => {
    expect(validateDealAttributes({ ...base, niche: NEW_NICHE_VALUE, newNiche: "X" }, { ...opts, canAddNiche: false }).ok).toBe(false);
    const r = validateDealAttributes({ ...base, niche: NEW_NICHE_VALUE }, opts);
    expect(!r.ok && r.fieldErrors.new_niche).toBeTruthy();
  });
});

describe("changedAttributes", () => {
  it("status lama setara tidak dihitung berubah; array kosong = null", () => {
    const after = { status: "stop" as const, niche: "Fashion", leads_type: null, support_types: null, priority: null, working_sheet: null, campaign_ops_id: null };
    expect(changedAttributes({ status: "done", niche: "Fashion", support_types: [] }, after)).toEqual([]);
    expect(changedAttributes({ status: "hold", niche: "Fashion" }, after)).toEqual(["status"]);
  });
});

describe("validateAdsSupport", () => {
  it("kosong = null, di luar daftar ditolak", () => {
    expect(validateAdsSupport(" ", ["Tidak Support Ads"])).toEqual({ ok: true, value: null });
    expect(validateAdsSupport("Tidak Support Ads", ["Tidak Support Ads"])).toEqual({ ok: true, value: "Tidak Support Ads" });
    expect(validateAdsSupport("Daily", ["Tidak Support Ads"]).ok).toBe(false);
  });
});
