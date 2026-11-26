/**
 * Données structurées (JSON-LD, schema.org) du site public : ce que les moteurs et les assistants lisent pour savoir ce
 * qu'est Dexlane, ce qu'il coûte et ce que dit chaque page. Tout vient des contenus du site (forfaits, FAQ, doc) : rien
 * n'est recopié ici.
 */
import type { DocPage } from "@/components/docs/content";
import { SEO } from "@/components/landing/content";
import { PLANS } from "@/config/plans";
import { GITHUB_URL, SITE_URL } from "@/config/site";

type Json = Record<string, unknown>;

const url = (path: string) => new URL(path, SITE_URL).toString();
const ORG_ID = url("/#organisation");
const SITE_ID = url("/#site");
const APP_ID = url("/#application");

/** Retire la mise en forme des textes du site (`**gras**`, `` `code` ``, `[lien](/adresse)`). */
export function plainText(s: string): string {
  return s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

/** Éditeur et site : sur toutes les pages publiques. */
export const organization: Json = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: "Dexlane",
  url: url("/"),
  logo: url("/icon-512.png"),
  sameAs: [GITHUB_URL],
};

export const website: Json = {
  "@type": "WebSite",
  "@id": SITE_ID,
  name: "Dexlane",
  url: url("/"),
  inLanguage: "fr-FR",
  publisher: { "@id": ORG_ID },
};

/** L'application et ses forfaits, prix tirés de config/plans.ts. */
export const softwareApplication: Json = {
  "@type": "SoftwareApplication",
  "@id": APP_ID,
  name: "Dexlane",
  url: url("/"),
  description: SEO.landing.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, iOS, Android",
  inLanguage: "fr-FR",
  publisher: { "@id": ORG_ID },
  offers: PLANS.map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    description: plan.pitch,
    price: plan.monthlyPriceEur.toFixed(2),
    priceCurrency: "EUR",
    url: url("/tarifs"),
    ...(plan.monthlyPriceEur > 0 && {
      priceSpecification: { "@type": "UnitPriceSpecification", price: plan.monthlyPriceEur.toFixed(2), priceCurrency: "EUR", unitCode: "MON" },
    }),
  })),
};

export function faqPage(items: { q: string; a: string }[], path: string): Json {
  return {
    "@type": "FAQPage",
    "@id": url(`${path}#faq`),
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: plainText(item.q),
      acceptedAnswer: { "@type": "Answer", text: plainText(item.a) },
    })),
  };
}

export function breadcrumb(items: { name: string; path: string }[]): Json {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: url(item.path) })),
  };
}

export function docArticle(page: DocPage): Json {
  return {
    "@type": "TechArticle",
    "@id": url(`/docs/${page.slug}#article`),
    headline: page.title,
    description: plainText(page.lead),
    url: url(`/docs/${page.slug}`),
    inLanguage: "fr-FR",
    isPartOf: { "@id": SITE_ID },
    about: { "@id": APP_ID },
    publisher: { "@id": ORG_ID },
  };
}

/** Balise JSON-LD : un graphe par page. `<` est échappé pour qu'un texte ne puisse pas fermer la balise. */
export function JsonLd({ graph }: { graph: Json[] }) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
