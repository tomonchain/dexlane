import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    // Les parcours de compte s'inscrivent : inscriptions ouvertes, sauf dans les tests de la liste d'attente.
    env: { DEXLANE_SIGNUP: "open" },
  },
});
