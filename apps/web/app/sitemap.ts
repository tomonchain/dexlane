import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

/** Pages publiques indexables. /colis (page d'arrivée du flyer) n'y figure pas. */
const PAGES = ["/", "/tarifs", "/docs", "/contact", "/mentions-legales", "/cgu", "/confidentialite"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: path === "/" || path === "/tarifs" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/tarifs" ? 0.8 : 0.5,
  }));
}
