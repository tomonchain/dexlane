import type { Metadata } from "next";
import { HERO_VARIANT, HERO_VARIANTS, type PageSeo } from "@/components/landing/content";

/** Image de partage commune (app/og.png/route.tsx). */
const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: HERO_VARIANTS[HERO_VARIANT].h1 };

/** Métadonnées d'une page marketing : titre et description propres, Open Graph, adresse canonique. */
export function pageMetadata(seo: PageSeo, path: string, opts: { ogTitle?: string; noindex?: boolean } = {}): Metadata {
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: path },
    robots: opts.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { type: "website", locale: "fr_FR", siteName: "Dexlane", url: path, title: opts.ogTitle ?? seo.title, description: seo.description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: opts.ogTitle ?? seo.title, description: seo.description, images: [OG_IMAGE.url] },
  };
}
