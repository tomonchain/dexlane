import type { Hono } from "hono";
import type { Db } from "@dexlane/db";
import type { Env } from "./env";
import type { Mailer } from "./mailer";
import type { SignupMode } from "./signup";

/*
 * Ce que l'instance ajoute à l'API (#116). Ce dépôt sert une boutique et n'ajoute rien ; l'édition hébergée
 * (dexlane.app) remplace ce fichier par le sien, comme apps/web/config/edition.ts. Un besoin nouveau de l'édition
 * hébergée s'ajoute ici, avec sa valeur pour une installation.
 */

/** Ce que l'API prête aux routes de l'édition. */
export interface EditionContext {
  /** Base sans cloisonnement : pour ce qui porte sur tout le service (administration, liste d'attente). */
  root: Db;
  /** Base cloisonnée au compte de la requête en cours. */
  sql: Db;
  /** Envoi des e-mails ; lève `EMAIL_NOT_CONFIGURED` s'il n'est pas configuré. */
  mailer: () => Mailer;
  /** Adresse publique du site (liens des e-mails). */
  baseUrl: () => string;
  /** Inscriptions ouvertes, ou sur invitation. */
  signup: SignupMode;
  onError: (err: unknown) => void;
}

export interface ApiEdition {
  /** Routes en plus, enregistrées après celles du cœur. Une route `/api/admin/…` vérifie elle-même le rôle. */
  routes(app: Hono<Env>, ctx: EditionContext): void;
  /** Chemins de ces routes qui travaillent hors de tout compte (comme `/api/public/…`, déjà hors compte). */
  unscoped(path: string): boolean;
}

export const apiEdition: ApiEdition = {
  routes: () => undefined,
  unscoped: () => false,
};
