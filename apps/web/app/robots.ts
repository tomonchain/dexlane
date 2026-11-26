import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

/** Le site marketing est ouvert aux moteurs ; l'application et ses API ne le sont pas. */
const APP_PATHS = [
  "/api/", "/auth", "/cron/", "/mcp", "/home", "/account", "/add", "/bulk", "/buying", "/card/", "/catalog", "/inventory",
  "/listings", "/locations", "/login", "/pricing", "/sales", "/scanner", "/settings", "/stats", "/stock", "/welcome", "/signup/verify", "/forgot-password", "/reset-password", "/lots", "/join",
];

/**
 * Robots des moteurs génératifs, nommés pour que leur accès au site public soit une décision écrite : recherche et
 * citation (OAI-SearchBot, Claude-SearchBot, PerplexityBot…), lecture à la demande d'un utilisateur (ChatGPT-User,
 * Claude-User…) et entraînement (GPTBot, ClaudeBot, Google-Extended). Ils suivent les mêmes règles que les autres.
 */
const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended", "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: ["*", ...AI_BOTS], allow: "/", disallow: APP_PATHS }],
    sitemap: [new URL("/sitemap.xml", SITE_URL).toString(), new URL("/series/sitemap.xml", SITE_URL).toString()],
  };
}
