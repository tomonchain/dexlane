import { SEO } from "@/components/landing/content";
import { Landing } from "@/components/landing/landing";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.landing, "/", { ogTitle: SEO.ogTitle });

/** La landing, rendue statiquement. Avec une session ouverte, proxy.ts sert l'accueil de l'application à cette adresse. */
export default function LandingPage() {
  return <Landing />;
}
