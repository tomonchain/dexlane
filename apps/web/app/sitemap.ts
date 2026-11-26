import type { MetadataRoute } from "next";
import { DOC_PAGES } from "@/components/docs/content";
import { SITE_URL } from "@/config/site";

/**
 * Pages publiques indexables, docs comprises. /colis (page d'arrivée du flyer) n'y figure pas. Les séries et les cartes
 * ont leur propre plan (/series/sitemap.xml).
 */
const PAGES = [
  "/", "/tarifs", "/series", "/docs", ...DOC_PAGES.map((p) => `/docs/${p.slug}`), "/contact", "/mentions-legales", "/cgu", "/confidentialite",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: path === "/" || path === "/tarifs" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/tarifs" ? 0.8 : 0.5,
  }));
}
