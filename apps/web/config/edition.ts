/*
 * Ce que l'instance ajoute autour de l'application. Ce dépôt sert une seule boutique : pas de page d'accueil publique,
 * pas de pages légales. L'édition hébergée (dexlane.app) remplace ce fichier par le sien (#105) ; un réglage nouveau
 * s'ajoute ici, avec sa valeur pour une installation.
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
  /**
   * Inscriptions fermées : adresse de la liste d'attente, où mènent `/signup` et la connexion ; `null` : inscription sur
   * invitation de l'équipe seulement (#116).
   */
  waitlist: string | null;
  /** Administration du service, liée depuis Réglages pour les administrateurs ; `null` : aucune. */
  admin: string | null;
}

export const EDITION: Edition = {
  landing: false,
  legal: null,
  tagline: "Du classeur à l'annonce eBay, en quelques secondes.",
  signupLead: "Le compte de ta boutique, pour scanner, ranger et vendre tes cartes.",
  ogImage: null,
  waitlist: null,
  admin: null,
};
