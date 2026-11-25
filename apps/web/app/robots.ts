import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

/** Le site marketing est ouvert aux moteurs ; l'application et ses API ne le sont pas. */
const APP_PATHS = [
  "/api/", "/auth", "/cron/", "/mcp", "/home", "/account", "/add", "/bulk", "/buying", "/card/", "/catalog", "/inventory",
  "/listings", "/locations", "/login", "/pricing", "/sales", "/scanner", "/settings", "/stats", "/stock", "/welcome",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: APP_PATHS }],
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
