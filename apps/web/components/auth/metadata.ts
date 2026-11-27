import type { Metadata } from "next";
import { EDITION } from "@/config/edition";
import type { PageSeo } from "./content";

/** Métadonnées d'un écran de compte : titre et description propres, adresse canonique, image de partage s'il y en a une. */
export function authMetadata(seo: PageSeo, path: string, opts: { noindex?: boolean } = {}): Metadata {
  const images = EDITION.ogImage ? [EDITION.ogImage] : undefined;
  return {
    title: { absolute: seo.title },
    description: seo.description,
    alternates: { canonical: path },
    robots: opts.noindex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { type: "website", locale: "fr_FR", siteName: "Dexlane", url: path, title: seo.title, description: seo.description, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: seo.title, description: seo.description, images: images?.map((i) => i.url) },
  };
}
