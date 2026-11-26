import type { ReactNode } from "react";
import { MarketingFooter } from "./footer";
import { MarketingHeader } from "./header";

/** En-tête, contenu et pied de page du site marketing (layout marketing et page 404). */
export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#contenu" className="sr-only rounded-md bg-card px-3 py-2 text-sm font-medium shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50">
        Aller au contenu
      </a>
      <MarketingHeader />
      <main id="contenu" className="min-h-[60vh]">{children}</main>
      <MarketingFooter />
    </>
  );
}
