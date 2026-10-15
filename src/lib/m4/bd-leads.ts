/**
 * ON CONFLICT target for bd_leads upserts. Since 0078 (Shopee dimension) the
 * unique key is (platform, shop_id) — `bd_leads_platform_shop_uniq`; the old
 * shop_id-only target no longer matches any constraint and every refresh of an
 * existing lead failed. Upsert payloads must therefore carry `platform`.
 */
export const BD_LEADS_CONFLICT = "platform,shop_id";
