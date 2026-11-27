import type { MetadataRoute } from "next";

/**
 * Une installation sert une boutique, pas un site : toute l'instance est fermée aux moteurs. L'édition hébergée
 * remplace ce fichier par celui de son site public.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
