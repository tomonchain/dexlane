import Link from "next/link";
import { FOOTER, NAV } from "@/components/landing/content";
import { GITHUB_URL } from "@/config/site";
import { Logo, Streaks } from "./ui";

const GROUPS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: NAV.groups.product,
    links: [
      { label: NAV.features, href: "/#fonctionnalites" },
      { label: NAV.pricing, href: "/tarifs" },
      { label: NAV.docs, href: "/docs" },
      { label: NAV.series, href: "/series" },
    ],
  },
  {
    title: NAV.groups.project,
    links: [
      { label: NAV.github, href: GITHUB_URL, external: true },
      { label: NAV.contact, href: "/contact" },
    ],
  },
  {
    title: NAV.groups.legalGroup,
    links: [
      { label: NAV.legal, href: "/mentions-legales" },
      { label: NAV.terms, href: "/cgu" },
      { label: NAV.privacy, href: "/confidentialite" },
    ],
  },
];

/** Pied de page du site marketing : trois groupes de liens, la mention d'indépendance, le nom en relief. */
export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-12 sm:px-8 sm:pt-16">
        <div className="grid gap-10 sm:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))]">
          <Link href="/" aria-label="Dexlane, accueil" className="self-start justify-self-start rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"><Logo /></Link>
          {GROUPS.map((group) => (
            <nav key={group.title} aria-labelledby={`pied-${group.title}`} className="grid content-start gap-4">
              <h2 id={`pied-${group.title}`} className="grid justify-items-start gap-2 text-sm font-medium">
                {group.title}
                <span aria-hidden className="h-0.5 w-8 rounded-full bg-[linear-gradient(90deg,#ffb86b,#f18a1f,#c4521a)]" />
              </h2>
              <ul className="grid gap-2.5 text-sm">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.external
                      ? <a href={link.href} target="_blank" rel="noreferrer" className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">{link.label}</a>
                      : <Link href={link.href} className="text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline">{link.label}</Link>}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{FOOTER.legalNotice}</p>
        <p
          aria-hidden
          className="pointer-events-none text-center text-[24vw] leading-[0.8] font-semibold tracking-[-0.06em] text-[color-mix(in_oklch,var(--background)_95%,var(--foreground))] select-none lg:text-[17rem]"
          style={{ textShadow: "0 2px 1px rgb(255 255 255 / 0.95), 0 -1px 1px rgb(0 0 0 / 0.14)" }}
        >
          dexlane
        </p>
      </div>
      <div aria-hidden className="relative mt-4 h-24 sm:h-32">
        <Streaks className="inset-0 [mask-image:linear-gradient(to_bottom,transparent,black_55%)]" angle={72} />
      </div>
    </footer>
  );
}
