import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { MarketingShell } from "@/components/marketing/shell";
import { ThemeProvider } from "@/components/theme";
import { SITE_URL } from "@/config/site";
import "../globals.css";

/**
 * Layout racine du site marketing : sans cookie ni session, pour que ses pages soient rendues statiquement.
 * L'application a son propre layout racine (app/(app)/layout.tsx).
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

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning : la classe de thème est posée avant l'hydratation par next-themes.
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <MarketingShell>{children}</MarketingShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
