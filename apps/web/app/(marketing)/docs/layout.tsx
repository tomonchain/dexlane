import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs/nav";

/** Documentation : le sommaire à gauche (menu repliable sur téléphone), la page à droite. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 pt-6 pb-20 sm:px-8 sm:pt-10 sm:pb-28 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14 lg:pt-14">
      <DocsNav />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
