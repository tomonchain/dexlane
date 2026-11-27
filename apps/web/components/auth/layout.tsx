import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { EbayLogo, Glow, Logo, ORANGE, RealCard } from "@/components/brand";
import { EDITION } from "@/config/edition";

/*
 * Mise en page des écrans de compte (connexion, inscription, mot de passe), sans en-tête ni pied de page.
 * À gauche, un mur de cartes qui défilent ; à droite, le logo, le formulaire et quelques liens. Sur téléphone, le mur
 * devient un bandeau de cartes au-dessus du formulaire. Les textes passent par t() : la connexion est dans l'application.
 */

const CARDS = ["006", "151", "025", "150", "094", "133", "143", "149", "004"];

type Tile = { card: string } | { tile: "ebay" | "sold" | "price" };

/** Une colonne du mur : surtout des cartes, quelques tuiles d'interface pour l'effet « bento ». */
const COLUMNS: Tile[][] = [
  [{ card: "006" }, { tile: "price" }, { card: "133" }, { card: "149" }, { tile: "ebay" }, { card: "025" }],
  [{ card: "151" }, { card: "004" }, { tile: "sold" }, { card: "094" }, { card: "150" }, { card: "143" }],
  [{ tile: "ebay" }, { card: "025" }, { card: "150" }, { tile: "price" }, { card: "006" }, { card: "133" }],
  [{ card: "143" }, { tile: "sold" }, { card: "094" }, { card: "151" }, { card: "004" }, { card: "149" }],
];
/** Durée d'un tour et sens de chaque colonne : deux montent, deux descendent, à des vitesses voisines. */
const MOTION = [
  { duration: "46s", direction: "normal" },
  { duration: "38s", direction: "reverse" },
  { duration: "52s", direction: "normal" },
  { duration: "42s", direction: "reverse" },
] as const;

const TILE = "rounded-[4.5%/3.3%] bg-white/[0.06] ring-1 ring-white/10";

function WallTile({ item }: { item: Tile }) {
  if ("card" in item) return <RealCard n={item.card} sizes="(min-width: 1024px) 12vw, 80px" className="shadow-[0_0_0_1px_rgb(255_255_255/0.06),0_18px_36px_-18px_rgb(0_0_0/0.8)]" />;
  if (item.tile === "ebay") {
    return (
      <span className={cn(TILE, "flex aspect-[4/3] items-center justify-center bg-white/90 ring-0")}>
        <EbayLogo className="h-[34%]" />
      </span>
    );
  }
  if (item.tile === "sold") {
    return (
      <span className={cn(TILE, "grid aspect-[4/3] content-center justify-items-center gap-3")}>
        <span className="flex size-10 items-center justify-center rounded-full" style={{ background: ORANGE }}>
          <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <span className="h-1.5 w-1/3 rounded-full bg-white/25" />
      </span>
    );
  }
  return (
    <span className={cn(TILE, "grid aspect-[4/3] content-end gap-2 p-4")}>
      <span className="flex h-12 items-end gap-1.5">
        {[40, 62, 48, 80, 66, 100].map((h, i) => (
          <span key={i} className="flex-1 rounded-t-[2px]" style={{ height: `${h}%`, background: i === 5 ? ORANGE : "rgb(255 255 255 / 0.16)" }} />
        ))}
      </span>
      <span className="h-1.5 w-1/2 rounded-full bg-white/20" />
    </span>
  );
}

/** Le mur de cartes (ordinateur) : quatre colonnes qui défilent en sens alternés, fondues en haut et en bas. */
function CardWall({ tagline }: { tagline?: string }) {
  return (
    <div className="relative m-3 hidden overflow-hidden rounded-3xl bg-[oklch(0.2_0.008_60)] ring-1 ring-black/5 lg:block dark:ring-white/10">
      <Glow className="-bottom-24 -left-24 size-[28rem] opacity-40" />
      <div
        aria-hidden
        className="absolute inset-0 grid grid-cols-4 gap-4 px-6 [mask-image:linear-gradient(to_bottom,transparent,black_14%,black_80%,transparent)]"
      >
        {COLUMNS.map((column, i) => (
          <div key={i} className={cn("overflow-hidden", i % 2 === 1 && "pt-24")}>
            <div className="auth-wall-column grid gap-4" style={{ "--auth-duration": MOTION[i]!.duration, "--auth-direction": MOTION[i]!.direction } as CSSProperties}>
              {/* Deux fois la même colonne : le défilement boucle sans couture. */}
              {[...column, ...column].map((item, j) => <WallTile key={j} item={item} />)}
            </div>
          </div>
        ))}
      </div>
      {tagline && (
        <p className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,oklch(0.2_0.008_60),transparent)] px-10 pt-24 pb-10 text-2xl leading-snug font-[450] tracking-[-0.025em] text-balance text-white">
          {tagline}
        </p>
      )}
    </div>
  );
}

/** Le bandeau de cartes (téléphone et tablette) : une rangée qui défile vers la gauche. */
function CardBand() {
  const row = [...CARDS, ...CARDS];
  return (
    <div aria-hidden className="-mx-5 overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] sm:-mx-10 lg:hidden">
      <div className="auth-band flex w-max gap-3">
        {row.map((n, i) => (
          <RealCard key={i} n={n} sizes="64px" className="w-16 shrink-0" style={{ rotate: `${((i % 3) - 1) * 3}deg` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Écran de compte en deux moitiés. `tagline` s'affiche au pied du mur de cartes ; `footer` s'ajoute aux liens du bas
 * (le choix de la langue sur la connexion).
 */
export function AuthLayout({ children, tagline, footer }: { children: ReactNode; tagline?: string; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-2">
      <CardWall tagline={tagline} />
      <div className="flex min-h-dvh flex-col gap-6 px-5 pt-5 pb-6 sm:px-10 sm:pt-8 lg:min-h-0 lg:overflow-y-auto">
        <Link href="/" aria-label={t("Dexlane, accueil")} className="flex h-8 items-center self-start rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
          <Logo />
        </Link>
        <CardBand />
        <div className="flex flex-1 items-center justify-center py-4 lg:py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-[13px] text-muted-foreground">
          {/* Les pages légales de l'instance, s'il y en a (config/edition.ts). */}
          <span className="flex gap-4">
            {EDITION.legal && (
              <>
                <Link href={EDITION.legal.terms} className="outline-none hover:text-foreground focus-visible:underline">{t("CGU")}</Link>
                <Link href={EDITION.legal.privacy} className="outline-none hover:text-foreground focus-visible:underline">{t("Confidentialité")}</Link>
                <Link href={EDITION.legal.contact} className="outline-none hover:text-foreground focus-visible:underline">{t("Contact")}</Link>
              </>
            )}
          </span>
          {footer}
        </div>
      </div>
    </div>
  );
}
