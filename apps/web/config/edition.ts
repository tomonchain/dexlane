import { HERO_VARIANT, HERO_VARIANTS } from "@/components/landing/content";
import { FREE_PLAN, formatCards } from "@/config/plans";

/*
 * Ce que l'instance ajoute autour de l'application. Le dépôt public sert une seule boutique, sans site ; l'édition
 * hébergée (dexlane.app) remplace ce fichier par le sien (#105).
 */

export interface Edition {
  /** Sans session, `/` sert la page d'accueil publique ; sinon, il mène à la connexion. */
  landing: boolean;
  /** Pages légales liées depuis les écrans de compte ; `null` : aucune. */
  legal: { terms: string; privacy: string; contact: string } | null;
  /** Phrase au pied du mur de cartes des écrans de compte (hors connexion). */
  tagline: string;
  /** Sous le titre de l'inscription, et description de la page pour les moteurs. */
  signupLead: string;
  /** Image de partage des écrans de compte ; `null` : aucune. */
  ogImage: { url: string; width: number; height: number; alt: string } | null;
}

export const EDITION: Edition = {
  landing: true,
  legal: { terms: "/cgu", privacy: "/confidentialite", contact: "/contact" },
  tagline: HERO_VARIANTS[HERO_VARIANT].h1,
  signupLead: `${formatCards(FREE_PLAN.cardsPerMonth)} cartes offertes chaque mois. Sans carte bancaire.`,
  ogImage: { url: "/og.png", width: 1200, height: 630, alt: HERO_VARIANTS[HERO_VARIANT].h1 },
};
