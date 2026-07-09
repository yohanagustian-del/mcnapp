import { redirect } from "next/navigation";

/**
 * /metrics retired (task C): the standalone "Data Platform" custom-report
 * upload page (mcn_tiktok_product/tap_tiktok_product/mcn_tiktok_live/
 * tap_tiktok_live/shopee/sap) has been consolidated into /ingest, which is now
 * the single upload entry point (Lane 1 TikTok + Shopee placeholder + Lane 2
 * leak artifact). The LIVE TikTok report types (mcn_tiktok_live/tap_tiktok_live)
 * were removed along with this page — not moved anywhere (user decision).
 */
export default function MetricsPage() {
  redirect("/ingest");
}
