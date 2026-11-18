import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme";
import { SESSION_COOKIE, parseSession } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "dexlane", template: "%s · dexlane" },
  description: "Stock et négoce de cartes Pokémon",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "dexlane", statusBarStyle: "default" },
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // La racine du site est publique pour un visiteur, et l'accueil de l'application pour le propriétaire connecté.
  let signedIn = false;
  try {
    signedIn = parseSession((await cookies()).get(SESSION_COOKIE)?.value) !== null;
  } catch {
    signedIn = false; // serveur sans jeton configuré : tout visiteur voit la page publique
  }
  return (
    // suppressHydrationWarning : la classe de thème est posée avant l'hydratation par next-themes.
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell signedIn={signedIn}>{children}</AppShell>
          <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
