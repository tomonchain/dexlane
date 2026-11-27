import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { ThemeProvider } from "@/components/theme";
import "./globals.css";

/**
 * Page 404 de toute l'instance (les adresses qui ne correspondent à aucune route). L'application et les écrans de
 * compte ont chacun leur layout racine : Next la rend sans layout, d'où l'import des styles et des polices ici.
 */
export const metadata: Metadata = {
  title: { absolute: "Cette page n'existe pas." },
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <main className="mx-auto grid min-h-dvh max-w-xl content-center justify-items-start gap-6 px-5 py-16">
            <Logo />
            <p className="font-mono text-sm text-muted-foreground">404</p>
            <h1 className="text-[2rem] leading-[1.06] font-[450] tracking-[-0.035em] text-balance">Cette page n'existe pas.</h1>
            <Link href="/" className="border-b border-foreground/40 pb-0.5 text-[15px] font-medium outline-none hover:border-foreground focus-visible:border-foreground">
              Accueil
            </Link>
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
