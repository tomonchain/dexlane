import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Version de l'application : celle du package.json racine (voir CHANGELOG.md), plus le commit déployé.
const APP_VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

// En développement, le serveur web lit le même fichier .env que l'API (racine du dépôt) : il lui faut
// DEXLANE_API_TOKEN, et DATABASE_URL en mode embarqué. Sans fichier (hébergement), les variables viennent de l'environnement.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // pas de .env : rien à charger
}

const config: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
    NEXT_PUBLIC_APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    // Inscriptions ouvertes (DEXLANE_SIGNUP=open), ou sur invitation : les écrans de compte en tiennent compte, au build.
    NEXT_PUBLIC_SIGNUP_OPEN: process.env.DEXLANE_SIGNUP === "open" ? "1" : "",
  },
  // Les tests e2e construisent dans leur propre dossier pour ne pas écraser un build ou un `next dev` en cours.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // `next dev` ne sert ses ressources qu'à localhost : lister ici les autres hôtes utilisés en développement
  // (IP locale pour tester depuis le téléphone), ex. DEXLANE_DEV_ORIGINS=192.168.1.20,mon-pc.local
  allowedDevOrigins: process.env.DEXLANE_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
  // Mode embarqué : l'API et le cœur métier (paquets du monorepo, en TypeScript) sont compilés avec l'application.
  transpilePackages: ["@dexlane/api", "@dexlane/catalog", "@dexlane/db", "@dexlane/insights", "@dexlane/inventory", "@dexlane/pricing", "@dexlane/listings", "@dexlane/scan", "@dexlane/shared"],
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
  async redirects() {
    // Production : une seule adresse pour les moteurs. Les domaines *.vercel.app mènent à dexlane.app, sauf les routes
    // machine (API, MCP, tâches planifiées) que des clients ou Vercel appellent encore à ces adresses.
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    const canonicalHost =
      process.env.VERCEL_ENV === "production" && site
        ? [
            { source: "/", destination: `${site}/` },
            { source: "/:path((?!api/|mcp|cron/).+)", destination: `${site}/:path` },
          ].map((rule) => ({ ...rule, has: [{ type: "host" as const, value: ".*\\.vercel\\.app" }], permanent: true }))
        : [];
    return canonicalHost;
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
