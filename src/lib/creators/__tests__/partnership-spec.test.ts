import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildPartnershipRows,
  isPartnershipRegression,
  mergePartnershipState,
  parseFeeAgreementStatus,
  parsePartnershipStatus,
  partnershipRegressions,
  partnershipStateChanged,
  partnershipTone,
  PARTNERSHIP_COLUMNS,
  PARTNERSHIP_REQUIRED_HEADERS,
  resolvePartnershipLabels,
} from "../partnership-spec";
import { buildPartnershipTemplate, PARTNERSHIP_TEMPLATE_FILENAME } from "../partnership-template";
import { parseSheet } from "@/lib/utils/sheet";

describe("normalisasi nilai status", () => {
  it("Management Partnership: LINKED/LINK/BINDING, NOT LINKED, LINK REQ, UNLINK REQ", () => {
    for (const raw of ["LINKED", "link", "Binding", " linked "]) {
      expect(parsePartnershipStatus(raw)).toEqual({ kind: "value", value: "linked" });
    }
    for (const raw of ["NOT LINKED", "not_linked", "Not-Linked"]) {
      expect(parsePartnershipStatus(raw)).toEqual({ kind: "value", value: "not_linked" });
    }
    expect(parsePartnershipStatus("LINK REQ")).toEqual({ kind: "value", value: "link_req" });
    expect(parsePartnershipStatus("UNLINK REQ")).toEqual({ kind: "value", value: "unlink_req" });
    expect(parsePartnershipStatus("")).toEqual({ kind: "blank" });
    expect(parsePartnershipStatus("pending?")).toEqual({ kind: "unknown", raw: "pending?" });
  });

  it("Fee Agreement: AGREE, DISAGREE, AGREEMENT REQ, CANCELATION/CANCELLATION REQ", () => {
    expect(parseFeeAgreementStatus("AGREE")).toEqual({ kind: "value", value: "agree" });
    expect(parseFeeAgreementStatus("disagree")).toEqual({ kind: "value", value: "disagree" });
    expect(parseFeeAgreementStatus("AGREEMENT REQ")).toEqual({ kind: "value", value: "agreement_req" });
    for (const raw of ["CANCELATION REQ", "CANCELLATION REQ", "cancellation_req"]) {
      expect(parseFeeAgreementStatus(raw)).toEqual({ kind: "value", value: "cancellation_req" });
    }
    expect(parseFeeAgreementStatus("  ")).toEqual({ kind: "blank" });
    expect(parseFeeAgreementStatus("ok")).toEqual({ kind: "unknown", raw: "ok" });
  });
});

describe("buildPartnershipRows", () => {
  it("platform kosong → tiktok; @ dibuang dari username", () => {
    const [r] = buildPartnershipRows([
      { username: "@vikahere", management_partnership: "LINKED", fee_agreement: "AGREE" },
    ]);
    expect(r).toMatchObject({ rowNumber: 2, username: "vikahere", platform: "tiktok", partnership: "linked", fee: "agree", error: null });
  });

  it("nilai tak dikenal ditandai, tidak crash, dan tidak menebak", () => {
    const [r] = buildPartnershipRows([
      { username: "abc", management_partnership: "???", fee_agreement: "AGREE" },
    ]);
    expect(r.partnership).toBeUndefined();
    expect(r.fee).toBe("agree");
    expect(r.issues[0]).toContain("tidak dikenal");
    expect(r.error).toBeNull();
  });

  it("Shopee: Fee Agreement diabaikan + dicatat", () => {
    const [r] = buildPartnershipRows([
      { username: "toko", platform: "Shopee", management_partnership: "LINK REQ", fee_agreement: "AGREE" },
    ]);
    expect(r.platform).toBe("shopee");
    expect(r.partnership).toBe("link_req");
    expect(r.fee).toBeUndefined();
    expect(r.issues.join(" ")).toContain("hanya untuk TikTok");
  });

  it("baris error: username kosong, platform asing, tanpa status, duplikat", () => {
    const rows = buildPartnershipRows([
      { username: "", management_partnership: "LINKED" },
      { username: "a", platform: "lazada", management_partnership: "LINKED" },
      { username: "b", management_partnership: "" },
      { username: "C", management_partnership: "LINKED" },
      { username: "c", management_partnership: "NOT LINKED" },
      { username: "c", platform: "shopee", management_partnership: "LINKED" },
    ]);
    expect(rows.map((r) => r.error === null)).toEqual([false, false, false, true, false, true]);
    expect(rows[4].error).toContain("lebih dari sekali");
  });

  it("baris kosong total dilewati, nomor baris tetap sesuai sheet", () => {
    const rows = buildPartnershipRows([
      { username: "", management_partnership: "" },
      { username: "x", management_partnership: "LINKED" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(3);
  });
});

describe("merge + regresi", () => {
  it("sel kosong mempertahankan nilai lama; Shopee selalu fee null", () => {
    const old = { partnership: "linked" as const, fee: "agree" as const };
    expect(mergePartnershipState(old, { platform: "tiktok", partnership: undefined, fee: "disagree" })).toEqual({
      partnership: "linked", fee: "disagree",
    });
    expect(mergePartnershipState(old, { platform: "shopee", partnership: "unlink_req", fee: undefined })).toEqual({
      partnership: "unlink_req", fee: null,
    });
    expect(mergePartnershipState(null, { platform: "tiktok", partnership: "link_req", fee: undefined })).toEqual({
      partnership: "link_req", fee: null,
    });
  });

  it("partnership: linked/link_req → unlink_req/not_linked = regresi", () => {
    for (const from of ["linked", "link_req"] as const) {
      for (const to of ["unlink_req", "not_linked"] as const) {
        expect(isPartnershipRegression({ partnership: from, fee: null }, { partnership: to, fee: null })).toBe(true);
      }
    }
    expect(isPartnershipRegression({ partnership: "not_linked", fee: null }, { partnership: "linked", fee: null })).toBe(false);
    expect(isPartnershipRegression({ partnership: "unlink_req", fee: null }, { partnership: "not_linked", fee: null })).toBe(false);
  });

  it("fee: agree → disagree/cancellation_req = regresi; selain dari agree bukan", () => {
    const base = { partnership: "linked" as const };
    expect(partnershipRegressions({ ...base, fee: "agree" }, { ...base, fee: "disagree" })).toEqual({ partnership: false, fee: true });
    expect(partnershipRegressions({ ...base, fee: "agree" }, { ...base, fee: "cancellation_req" }).fee).toBe(true);
    expect(partnershipRegressions({ ...base, fee: "agreement_req" }, { ...base, fee: "disagree" }).fee).toBe(false);
  });

  it("upload pertama (tanpa status lama) bukan regresi", () => {
    expect(isPartnershipRegression(null, { partnership: "not_linked", fee: "disagree" })).toBe(false);
  });

  it("partnershipStateChanged", () => {
    expect(partnershipStateChanged(null, { partnership: null, fee: null })).toBe(false);
    expect(partnershipStateChanged(null, { partnership: "linked", fee: null })).toBe(true);
    expect(partnershipStateChanged({ partnership: "linked", fee: "agree" }, { partnership: "linked", fee: "agree" })).toBe(false);
  });
});

describe("tone + label", () => {
  it("hijau/kuning/merah/abu", () => {
    expect(partnershipTone("linked")).toBe("green");
    expect(partnershipTone("agree")).toBe("green");
    expect(partnershipTone("link_req")).toBe("yellow");
    expect(partnershipTone("agreement_req")).toBe("yellow");
    for (const s of ["unlink_req", "not_linked", "disagree", "cancellation_req"] as const) {
      expect(partnershipTone(s)).toBe("red");
    }
    expect(partnershipTone(null)).toBe("none");
  });

  it("label dari app_config, fallback ke konstanta", () => {
    const l = resolvePartnershipLabels({ partnership: { linked: { label: "BINDING", meaning: "Binding" } } });
    expect(l.partnership.linked).toEqual({ label: "BINDING", meaning: "Binding" });
    expect(l.partnership.not_linked.label).toBe("NOT LINKED");
    expect(l.fee_agreement.cancellation_req.label).toBe("CANCELATION REQ");
    expect(resolvePartnershipLabels(null).fee_agreement.agree.label).toBe("AGREE");
  });
});

describe("template", () => {
  const labels = resolvePartnershipLabels({
    partnership: { link_req: { label: "LINK REQ", meaning: "Undangan dikirim" } },
  });
  const wb = () => XLSX.read(buildPartnershipTemplate(labels), { type: "array" });

  it("header sama persis dengan PARTNERSHIP_COLUMNS + petunjuk berisi arti status", () => {
    const w = wb();
    expect(w.SheetNames).toEqual(["Status Kemitraan", "Petunjuk"]);
    const header = XLSX.utils.sheet_to_json<string[]>(w.Sheets["Status Kemitraan"], { header: 1 })[0];
    expect(header).toEqual(PARTNERSHIP_COLUMNS.map((c) => c.label));
    const guide = XLSX.utils.sheet_to_csv(w.Sheets.Petunjuk);
    expect(guide).toContain("LINK REQ: Undangan dikirim");
    expect(guide).toContain("Username*,WAJIB");
  });

  it("round-trip: template diisi → parseSheet → buildPartnershipRows terbaca", async () => {
    const w = wb();
    const row = PARTNERSHIP_COLUMNS.map((c) =>
      ({ username: "richannelvt", name: "Rich", platform: "", partnership: "LINK", fee: "CANCELATION REQ" })[c.key]
    );
    XLSX.utils.sheet_add_aoa(w.Sheets["Status Kemitraan"], [row], { origin: "A2" });
    const buf = XLSX.write(w, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = new File([buf], PARTNERSHIP_TEMPLATE_FILENAME);
    const { rows, errors } = await parseSheet(file, PARTNERSHIP_REQUIRED_HEADERS);
    expect(errors).toEqual([]);
    const parsed = buildPartnershipRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      username: "richannelvt", name: "Rich", platform: "tiktok", partnership: "linked", fee: "cancellation_req", error: null,
    });
  });
});
