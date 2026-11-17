import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning : la classe de thème est posée avant l'hydratation par next-themes.
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
          <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
        </ThemeProvider>
      </body>
    </html>
  );
}
