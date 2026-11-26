import type { Db } from "@dexlane/db";
import { EbayClient, ebayConfigFromEnv } from "./api";
import { ebayAdapter } from "./adapter";

export * from "./api";
export * from "./aspects";
export * from "./adapter";
export * from "./setup";

/** Client eBay d'après l'environnement (EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME, EBAY_ENV) ; null sans identifiants. */
export function ebayClientFromEnv(sql: Db, env: Record<string, string | undefined>, fetcher?: typeof fetch): EbayClient | null {
  const config = ebayConfigFromEnv(env);
  return config ? new EbayClient(sql, config, fetcher) : null;
}

export { ebayAdapter };
