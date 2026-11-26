// Texte à faire relire avant mise en ligne.
import { NAV, SEO } from "@/components/landing/content";
import { LegalPage, type LegalSection } from "@/components/marketing/legal";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.mentionsLegales, "/mentions-legales");

const TODO = "[À COMPLÉTER]";

const SECTIONS: LegalSection[] = [
  {
    id: "editeur",
    title: "Éditeur",
    fields: [
      { label: "Raison sociale", value: TODO },
      { label: "Forme juridique", value: TODO },
      { label: "Adresse", value: TODO },
      { label: "Numéro d'immatriculation", value: TODO },
      { label: "Numéro de TVA", value: TODO },
    ],
  },
  { id: "directeur-publication", title: "Directeur de la publication", fields: [{ label: "Nom", value: TODO }] },
  {
    id: "hebergeur",
    title: "Hébergeur",
    fields: [
      { label: "Raison sociale", value: TODO },
      { label: "Adresse", value: TODO },
      { label: "Contact", value: TODO },
    ],
  },
  { id: "contact", title: "Contact", fields: [{ label: "Adresse e-mail", value: TODO }] },
];

export default function LegalNoticePage() {
  return <LegalPage title={NAV.legal} sections={SECTIONS} />;
}
