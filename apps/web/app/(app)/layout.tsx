import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import { I18nProvider } from "@/components/i18n-provider";
import { ThemeProvider } from "@/components/theme";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";
import { hasSessionCookie } from "@/lib/session";
import "../globals.css";

async function requestLocale() {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: { default: "dexlane", template: "%s · dexlane" },
    description: locale === "en" ? "Pokémon card stock and trading" : "Stock et négoce de cartes Pokémon",
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: "dexlane", statusBarStyle: "default" },
  };
}

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
  const signedIn = hasSessionCookie(await cookies());
  const locale = await requestLocale();
  return (
    // suppressHydrationWarning : la classe de thème est posée avant l'hydratation par next-themes.
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <I18nProvider locale={locale}>
          <ThemeProvider>
            <AppShell signedIn={signedIn}>{children}</AppShell>
            <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
