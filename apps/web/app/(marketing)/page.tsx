import { FAQ, SEO } from "@/components/landing/content";
import { Landing } from "@/components/landing/landing";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, faqPage, softwareApplication } from "@/components/marketing/structured-data";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.landing, "/", { ogTitle: SEO.ogTitle });

/** La landing, rendue statiquement. Avec une session ouverte, proxy.ts sert l'accueil de l'application à cette adresse. */
export default function LandingPage() {
  return (
    <>
      <JsonLd graph={[softwareApplication, faqPage(FAQ.items, "/")]} />
      <Landing />
    </>
  );
}
