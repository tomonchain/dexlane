import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Home } from "@/components/home";
import { SEO } from "@/components/landing/content";
import { Landing } from "@/components/landing/landing";
import { SESSION_COOKIE, parseSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function isSignedIn() {
  try {
    return parseSession((await cookies()).get(SESSION_COOKIE)?.value) !== null;
  } catch {
    return false;
  }
}

/** Le visiteur reçoit le référencement de la landing ; le propriétaire connecté garde le titre de l'application. */
export async function generateMetadata(): Promise<Metadata> {
  if (await isSignedIn()) return {};
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return {
    ...(host ? { metadataBase: new URL(`https://${host}`) } : {}),
    title: { absolute: SEO.title },
    description: SEO.description,
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
    openGraph: {
      type: "website", locale: "fr_FR", siteName: "Dexlane", url: "/",
      title: SEO.ogTitle, description: SEO.description,
      images: [{ url: "/landing/stock-desktop-v2.png", width: 2560, height: 1440, alt: "L'écran Stock de Dexlane" }],
    },
    twitter: { card: "summary_large_image", title: SEO.ogTitle, description: SEO.description, images: ["/landing/stock-desktop-v2.png"] },
  };
}

/**
 * Éléments « à confirmer » de la landing : visibles avec leur repère en développement et en preview (ou avec
 * LANDING_REVIEW=1), retirés en production.
 */
const review = process.env.LANDING_REVIEW === "1" || process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";

/** Racine du site : la landing pour un visiteur, l'accueil de l'application une fois connecté. */
export default async function RootPage() {
  return (await isSignedIn()) ? <Home /> : <Landing review={review} />;
}
