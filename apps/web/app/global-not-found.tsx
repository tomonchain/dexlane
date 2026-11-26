import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import Link from "next/link";
import { NOT_FOUND, SEO } from "@/components/landing/content";
import { MarketingShell } from "@/components/marketing/shell";
import { SectionTitle } from "@/components/marketing/ui";
import { ThemeProvider } from "@/components/theme";
import "./globals.css";

/**
 * Page 404 de tout le site (les adresses qui ne correspondent à aucune route). Le site a deux layouts racine, marketing
 * et application : Next la rend sans layout, d'où l'import des styles et des polices ici.
 */
export const metadata: Metadata = {
  title: { absolute: SEO.notFound },
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <MarketingShell>
            <div className="mx-auto grid max-w-3xl justify-items-start gap-8 px-4 py-24 sm:px-8 sm:py-36">
              <p className="font-mono text-sm text-muted-foreground">404</p>
              <SectionTitle as="h1">{NOT_FOUND.title}</SectionTitle>
              <Link href="/" className="border-b border-foreground/40 pb-0.5 text-[15px] font-medium outline-none hover:border-foreground focus-visible:border-foreground">
                {NOT_FOUND.home}
              </Link>
            </div>
          </MarketingShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
