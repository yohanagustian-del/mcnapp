import { redirect } from "next/navigation";

/**
 * Portal "Ads Support (M10)" lama dialihkan ke Request Ads (D-2026-10-31): satu jalur
 * request → ACC Finance/Head CM → eksekusi Creator Support. Tautan lama tetap hidup.
 */
export default function AdsWorkspaceRedirect() {
  redirect("/ads");
}
