// Texte à faire relire avant mise en ligne.
import { NAV, SEO } from "@/components/landing/content";
import { LegalPage, type LegalSection } from "@/components/marketing/legal";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.cgu, "/cgu");

const TODO = "[À COMPLÉTER]";

/** Conditions générales d'utilisation et de vente : la structure, sans contenu juridique inventé. */
const SECTIONS: LegalSection[] = [
  { id: "objet", title: "Objet", paragraphs: [TODO] },
  { id: "compte", title: "Compte", paragraphs: [TODO] },
  { id: "forfaits-facturation", title: "Forfaits et facturation", paragraphs: [TODO] },
  { id: "quota-depassement", title: "Quota de cartes et dépassement", paragraphs: [TODO] },
  { id: "resiliation", title: "Résiliation", paragraphs: [TODO] },
  { id: "responsabilite", title: "Responsabilité", paragraphs: [TODO] },
  { id: "droit-applicable", title: "Droit applicable", paragraphs: [TODO] },
];

export default function TermsPage() {
  return <LegalPage title={NAV.terms} sections={SECTIONS} />;
}
