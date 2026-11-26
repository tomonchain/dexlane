import type { MetadataRoute } from "next";
import { DOC_PAGES } from "@/components/docs/content";
import { publishedGuides } from "@/lib/guides";
import { SITE_URL } from "@/config/site";

/**
 * Pages publiques indexables, docs comprises. /colis (page d'arrivée du flyer) n'y figure pas. Les séries et les cartes
 * ont leur propre plan (/series/sitemap.xml).
 */
const PAGES = [
  "/", "/tarifs", "/series", "/docs", ...DOC_PAGES.map((p) => `/docs/${p.slug}`), "/contact", "/mentions-legales", "/cgu", "/confidentialite",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const guides = publishedGuides();
  return [
    ...PAGES.map((path) => ({
      url: new URL(path, SITE_URL).toString(),
      changeFrequency: path === "/" || path === "/tarifs" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "/" ? 1 : path === "/tarifs" ? 0.8 : 0.5,
    })),
    // Les guides, une fois le premier publié (l'index vide reste hors des moteurs).
    ...(guides.length === 0 ? [] : [{ url: new URL("/guides", SITE_URL).toString(), changeFrequency: "weekly" as const, priority: 0.7 }]),
    ...guides.map((g) => ({ url: new URL(`/guides/${g.slug}`, SITE_URL).toString(), lastModified: g.updated ?? g.date, changeFrequency: "monthly" as const, priority: 0.7 })),
  ];
}
