import { serve } from "@hono/node-server";
import { createDb } from "@dexlane/db";
import { createClaudeRecognizer, type CardRecognizer } from "@dexlane/scan";
import { createApp } from "./app";
import { createBlobPhotoStore } from "./photos";

const token = process.env.DEXLANE_API_TOKEN ?? "";
if (token.length < 24) {
  console.error("DEXLANE_API_TOKEN must be set to a secret of at least 24 characters (e.g. `openssl rand -hex 24`)");
  process.exit(1);
}

const sql = createDb();
let recognizer: CardRecognizer | undefined;
const app = createApp({
  sql,
  token,
  photos: createBlobPhotoStore(),
  recognizer: () => (recognizer ??= createClaudeRecognizer({ model: process.env.SCAN_MODEL || undefined })),
});

// Écoute locale par défaut : l'exposition (reverse proxy TLS, VPN) est un choix de déploiement explicite.
const server = serve(
  { fetch: app.fetch, hostname: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 8787) },
  (info) => console.log(`dexlane api listening on http://${info.address}:${info.port}`),
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => void sql.end().then(() => process.exit(0)));
  });
}
