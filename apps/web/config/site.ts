/** Adresses du site marketing, à un seul endroit. `[À COMPLÉTER]` : valeur non fournie. */

/** URL publique du site (sitemap, robots, Open Graph). Sur Vercel, l'adresse de production est connue au build. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const GITHUB_URL = "https://github.com/tomonchain/dexlane";
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;

/** Adresse de contact (« Écrire à Thomas », page Contact). */
export const CONTACT_EMAIL = "[À COMPLÉTER]";

export const SIGNUP_URL = "/signup";
/**
 * Inscriptions ouvertes (`DEXLANE_SIGNUP=open`, lu au build) ; sinon, `/signup` est une liste d'attente, tant que les
 * e-mails et le paiement des forfaits ne sont pas branchés (#103).
 */
export const SIGNUP_OPEN = process.env.NEXT_PUBLIC_SIGNUP_OPEN === "1";
export const LOGIN_URL = "/login";
