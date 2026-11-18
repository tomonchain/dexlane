import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_TOKEN, E2E_WEB_PORT } from "./e2e/constants";

/**
 * Parcours de bout en bout : navigateur mobile → Next → API réelle → PostgreSQL de test.
 * Seule la lecture de carte par Claude est remplacée (voir e2e/harness.ts).
 * Prérequis : TEST_DATABASE_URL et `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  testDir: "./e2e",
  // Une seule base partagée : les parcours s'exécutent l'un après l'autre.
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`,
    locale: "fr-FR",
    trace: "off",
    // Sur un poste où Chromium est déjà installé ailleurs (pas de `playwright install` possible), indiquer son chemin.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "tsx e2e/harness.ts",
      url: `http://127.0.0.1:${E2E_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Build de production : c'est ce qui tourne réellement, et `next dev` refuse par défaut
      // de servir ses ressources à une autre origine que localhost.
      command: `next build && next start -p ${E2E_WEB_PORT}`,
      url: `http://127.0.0.1:${E2E_WEB_PORT}/login`,
      env: {
        DEXLANE_API_URL: `http://127.0.0.1:${E2E_API_PORT}`,
        DEXLANE_API_TOKEN: E2E_TOKEN,
        NEXT_DIST_DIR: ".next-e2e",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
