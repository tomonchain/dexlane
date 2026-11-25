import type { NextConfig } from "next";

// En développement, le serveur web lit le même fichier .env que l'API (racine du dépôt) : il lui faut
// DEXLANE_API_TOKEN, et DATABASE_URL en mode embarqué. Sans fichier (hébergement), les variables viennent de l'environnement.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // pas de .env : rien à charger
}

const config: NextConfig = {
  // Les tests e2e construisent dans leur propre dossier pour ne pas écraser un build ou un `next dev` en cours.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // `next dev` ne sert ses ressources qu'à localhost : lister ici les autres hôtes utilisés en développement
  // (IP locale pour tester depuis le téléphone), ex. DEXLANE_DEV_ORIGINS=192.168.1.20,mon-pc.local
  allowedDevOrigins: process.env.DEXLANE_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
  // Mode embarqué : l'API et le cœur métier (paquets du monorepo, en TypeScript) sont compilés avec l'application.
  transpilePackages: ["@dexlane/api", "@dexlane/catalog", "@dexlane/db", "@dexlane/inventory", "@dexlane/pricing", "@dexlane/listings", "@dexlane/scan", "@dexlane/shared"],
  poweredByHeader: false,
  // Deux layouts racine (site marketing et application) : la page 404 de tout le site est app/global-not-found.tsx.
  experimental: { globalNotFound: true },
  // OpenCV.js (recadrage des photos de cartes, dans le navigateur) mentionne `fs` et `crypto` pour son usage sous
  // Node : côté navigateur, ils sont remplacés par un module vide.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/empty-module.ts" },
      crypto: { browser: "./lib/empty-module.ts" },
    },
  },
  // Les anciennes adresses françaises (favoris, écran d'accueil, notifications déjà reçues) mènent aux nouvelles.
  async redirects() {
    const pages: [string, string][] = [
      ["/reglages/annonces", "/settings/listing"], ["/reglages/alertes", "/settings/alerts"], ["/reglages/boutique", "/settings/shop"],
      ["/reglages/canaux", "/settings/channels"], ["/reglages/envois", "/settings/shipping"], ["/reglages/saisie", "/settings/intake"],
      ["/reglages/:path*", "/settings/:path*"], ["/ventes/nouvelle", "/sales/new"], ["/ventes/:path*", "/sales/:path*"],
      ["/scanner/lot/:path*", "/scanner/batch/:path*"], ["/mises-en-ligne", "/listings"], ["/annonces", "/listings"],
      ["/statistiques", "/stats"], ["/catalogue/:path*", "/catalog/:path*"], ["/inventaire/:path*", "/inventory/:path*"],
      ["/rangement", "/locations"], ["/achats", "/buying"], ["/ajouter", "/add"], ["/bienvenue", "/welcome"], ["/compte", "/account"],
      ["/carte/:path*", "/card/:path*"], ["/prix", "/pricing"], ["/vrac", "/bulk"], ["/fournitures", "/stock?section=supplies"],
    ];
    const query = (key: string, value?: string) => [{ type: "query" as const, key, ...(value ? { value } : {}) }];
    return [
      ...pages.map(([source, destination]) => ({ source, destination, permanent: true })),
      // Paramètres d'adresse passés à l'anglais.
      // L'ancien paramètre est repassé à la destination : la règle exige l'absence du nouveau, pour ne pas boucler.
      { source: "/stock", has: query("categorie", "fournitures"), missing: query("section"), destination: "/stock?section=supplies", permanent: true },
      { source: "/stock", has: query("categorie", "mouvements"), missing: query("section"), destination: "/stock?section=movements", permanent: true },
      { source: "/stock", has: query("statut", "(?<status>[A-Z_]+)"), missing: query("status"), destination: "/stock?status=:status", permanent: true },
      { source: "/stats", has: query("vue", "cotes"), missing: query("view"), destination: "/stats?view=prices", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
