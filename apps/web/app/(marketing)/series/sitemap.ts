import type { MetadataRoute } from "next";
import { cardPath, setPath } from "@/components/series/format";
import { SITE_URL } from "@/config/site";
import { publicSitemap } from "@/lib/public-catalog";

/** Recalculé une fois par jour, comme les cotes. */
export const revalidate = 86400;

/** Plan des pages de séries et de cartes (/series/sitemap.xml) : toutes les séries, et les cartes qui ont une cote. */
export default async function seriesSitemap(): Promise<MetadataRoute.Sitemap> {
  const { sets, cards } = await publicSitemap();
  const url = (path: string) => new URL(path, SITE_URL).toString();
  return [
    ...sets.map((set) => ({ url: url(setPath(set)), lastModified: set.updatedAt ?? undefined, changeFrequency: "daily" as const, priority: 0.6 })),
    ...cards.map((card) => ({
      url: url(cardPath({ id: card.setId, name: card.setName }, card)),
      lastModified: card.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.4,
    })),
  ];
}
