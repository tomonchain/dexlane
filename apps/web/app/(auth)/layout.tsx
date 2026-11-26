import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme";
import { SITE_URL } from "@/config/site";
import "../globals.css";

/**
 * Layout racine des écrans de compte du site (inscription, vérification de l'adresse, mot de passe oublié) : sans
 * l'en-tête ni le pied de page marketing, chaque page se pose dans AuthLayout. Comme le site marketing, sans cookie ni
 * session, pour un rendu statique. La connexion, elle, vit dans l'application (app/(app)/login).
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Dexlane",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e0d" },
  ],
};

export default function AuthRootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning : la classe de thème est posée avant l'hydratation par next-themes.
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
