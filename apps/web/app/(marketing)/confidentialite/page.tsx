// Texte à faire relire avant mise en ligne.
import { NAV, SEO } from "@/components/landing/content";
import { LegalPage, type LegalSection } from "@/components/marketing/legal";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.confidentialite, "/confidentialite");

const TODO = "[À COMPLÉTER]";

/** Politique de confidentialité : la structure, sans contenu juridique inventé. */
const SECTIONS: LegalSection[] = [
  {
    id: "donnees-collectees",
    title: "Données collectées",
    fields: [
      { label: "Compte", value: TODO },
      { label: "Inventaire", value: TODO },
      { label: "Jetons d'accès eBay", value: TODO },
    ],
  },
  { id: "finalites", title: "Finalités", paragraphs: [TODO] },
  { id: "duree-conservation", title: "Durée de conservation", paragraphs: [TODO] },
  {
    id: "sous-traitants",
    title: "Sous-traitants",
    fields: [
      { label: "Hébergeur", value: TODO },
      { label: "Paiement", value: TODO },
      { label: "E-mail", value: TODO },
    ],
  },
  { id: "droits", title: "Droits de l'utilisateur", paragraphs: [TODO] },
  { id: "suppression", title: "Suppression du compte et des données eBay associées", paragraphs: [TODO] },
  { id: "contact", title: "Contact", fields: [{ label: "Adresse e-mail", value: TODO }] },
];

export default function PrivacyPage() {
  return <LegalPage title={NAV.privacy} sections={SECTIONS} />;
}
