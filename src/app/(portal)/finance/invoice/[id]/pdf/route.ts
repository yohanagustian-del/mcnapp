import { NextResponse } from "next/server";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadInvoice } from "@/lib/m10/invoice-data";
import { buildInvoicePdf } from "@/lib/m10/invoice-pdf";

/** Unduh invoice sebagai PDF. Akses = siapa pun yang boleh membuka /finance atau /ads (sesi internal). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireMember();
  const allowed =
    hasPermission("finance.view", member.role) ||
    member.role === "od_viewer" ||
    canAccessNav(NAV_ITEMS.find((n) => n.href === "/ads")!, member.role);
  if (!allowed) return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });

  const invoice = await loadInvoice(id);
  if (!invoice) return NextResponse.json({ error: "Invoice tidak ditemukan" }, { status: 404 });

  const admin = createAdminClient();
  const { data: issuer } = await admin.from("ads_invoices").select("created_by, team_members(name)").eq("id", id).maybeSingle();
  const issuedByName = (issuer?.team_members as unknown as { name?: string } | null)?.name ?? null;

  const bytes = await buildInvoicePdf({ invoice, requestObjective: invoice.objective, issuedByName });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoice.id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
