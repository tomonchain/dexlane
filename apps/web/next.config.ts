import type { NextConfig } from "next";

const config: NextConfig = {
  // Les tests e2e construisent dans leur propre dossier pour ne pas écraser un build ou un `next dev` en cours.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // `next dev` ne sert ses ressources qu'à localhost : lister ici les autres hôtes utilisés en développement
  // (IP locale pour tester depuis le téléphone), ex. DEXLANE_DEV_ORIGINS=192.168.1.20,mon-pc.local
  allowedDevOrigins: process.env.DEXLANE_DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
  // Mode embarqué : l'API et le cœur métier (paquets du monorepo, en TypeScript) sont compilés avec l'application.
  transpilePackages: ["@dexlane/api", "@dexlane/catalog", "@dexlane/db", "@dexlane/inventory", "@dexlane/scan", "@dexlane/shared"],
  poweredByHeader: false,
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
