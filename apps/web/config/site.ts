/** Adresses du site marketing, à un seul endroit. `[À COMPLÉTER]` : valeur non fournie. */

/** URL publique du site (sitemap, robots, Open Graph). Sur Vercel, l'adresse de production est connue au build. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const GITHUB_URL = "https://github.com/tomonchain/dexlane";
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;
/** Les docs pointent pour l'instant vers le README du dépôt. */
export const README_URL = `${GITHUB_URL}#readme`;

/** Adresse de contact (« Écrire à Thomas », page Contact). */
export const CONTACT_EMAIL = "[À COMPLÉTER]";

export const SIGNUP_URL = "/signup";
export const LOGIN_URL = "/login";
