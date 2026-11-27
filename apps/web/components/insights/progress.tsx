"use client";

import type { AchievementCategory, AchievementRarity } from "@dexlane/insights/config";
import { levelPerks, levelThresholds } from "@dexlane/insights/config";
import type { CSSProperties, ReactElement } from "react";
import { dateFormat, formatNumber } from "@/lib/format";
import { levelLabel, salesToGo, type AchievementState, type LevelState, type ProgressView } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ProgressBar } from "./onboarding";

/** Icônes des succès : un jeu sobre et géométrique, une forme par catégorie. */
const SHAPES: Record<AchievementCategory, (props: { className?: string }) => ReactElement> = {
  start: ({ className }) => <svg viewBox="0 0 24 24" className={className}><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>,
  sales: ({ className }) => <svg viewBox="0 0 24 24" className={className}><circle cx="12" cy="12" r="7.5" fill="currentColor" /></svg>,
  quality: ({ className }) => <svg viewBox="0 0 24 24" className={className}><path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" fill="currentColor" /></svg>,
  speed: ({ className }) => <svg viewBox="0 0 24 24" className={className}><path d="M12 4 20.5 19H3.5Z" fill="currentColor" /></svg>,
  regularity: ({ className }) => <svg viewBox="0 0 24 24" className={className}><path d="M12 3.5 19.4 7.75v8.5L12 20.5l-7.4-4.25v-8.5Z" fill="currentColor" /></svg>,
  referral: ({ className }) => <svg viewBox="0 0 24 24" className={className}><circle cx="9" cy="12" r="5" fill="currentColor" /><circle cx="15" cy="12" r="5" fill="currentColor" opacity="0.55" /></svg>,
};

export function AchievementIcon({ category, unlocked, className }: { category: AchievementCategory; unlocked: boolean; className?: string }) {
  const Shape = SHAPES[category];
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", unlocked ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground/40", className)} aria-hidden>
      <Shape className="size-5" />
    </span>
  );
}

const unlockedDate = () => dateFormat({ day: "numeric", month: "long", year: "numeric" });
const RARITY_LABEL: Record<AchievementRarity, string> = { common: "Commune", uncommon: "Peu commune", rare: "Rare", holo: "Holo", secret: "Secrète" };

// ───────────────────────── Carte vendeur ─────────────────────────

/** La matière du cadre de la carte vendeur, niveau par niveau (0 : pas encore de cadre). */
const MATERIALS: { frame: string; ink: string }[] = [
  { frame: "transparent", ink: "#6b655e" },
  { frame: "linear-gradient(135deg, #dcc39a, #b8956a 55%, #cfb184)", ink: "#5b4426" }, // Carton
  { frame: "repeating-linear-gradient(100deg, #8a5a2e 0 7px, #9c6a3a 7px 13px, #7a4d25 13px 18px)", ink: "#4a2c12" }, // Bois
  { frame: "linear-gradient(135deg, #b4b6ba, #7c7f84 50%, #a2a5aa)", ink: "#3f4246" }, // Pierre
  { frame: "linear-gradient(135deg, #8c97a1, #4f5961 50%, #7a858f)", ink: "#2e353b" }, // Fer
  { frame: "linear-gradient(135deg, #e0a76b, #96582a 50%, #c98a4e)", ink: "#5c3313" }, // Bronze
  { frame: "linear-gradient(135deg, #f4f6f8, #a9b1b9 50%, #e2e6ea)", ink: "#4b525a" }, // Argent
  { frame: "linear-gradient(135deg, #fbe7a1, #c9971c 50%, #f1cf63)", ink: "#6b4d07" }, // Or
  { frame: "linear-gradient(135deg, #ffffff, #c7ccd6 45%, #eef2f7 70%, #b9c0cc)", ink: "#454c58" }, // Platine
  { frame: "linear-gradient(135deg, #e9fbff, #8fd3f5 35%, #ffffff 55%, #6cc3ee 80%, #d8f3ff)", ink: "#1f5d7a" }, // Diamant
  { frame: "conic-gradient(from 210deg, #f18a1f, #e8484f, #8a4fe8, #3fa2f0, #3fd19a, #f1c21f, #f18a1f)", ink: "#7a3a06" }, // Légende
];

/**
 * La carte vendeur du compte : même format que les cartes de succès ; à chaque niveau, son cadre change de matière.
 */
export function SellerCard({ level, shopName }: { level: LevelState; shopName: string | null }) {
  const material = MATERIALS[Math.min(level.level, MATERIALS.length - 1)]!;
  const framed = level.level > 0;
  return (
    <div
      className={cn("aspect-[63/88] w-full max-w-64 rounded-[18px] p-2.5 shadow-lg", !framed && "border-2 border-dashed border-border shadow-none")}
      style={{ background: material.frame } as CSSProperties}
      data-testid="seller-card" data-level={level.level}
    >
      <div className="flex h-full flex-col justify-between rounded-[12px] bg-card p-4 text-card-foreground">
        <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>dexlane</span>
          <span>{level.level > 0 ? t("Niveau {n}", { n: level.level }) : t("Sans niveau")}</span>
        </div>
        <div className="grid gap-1 text-center">
          <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{t("Carte vendeur")}</span>
          <span className="text-3xl font-semibold tracking-tight" style={{ color: framed ? material.ink : undefined }} data-testid="seller-level">
            {level.level > 0 ? levelLabel(level.level) : "—"}
          </span>
          {shopName && <span className="truncate text-sm text-muted-foreground">{shopName}</span>}
        </div>
        <div className="grid gap-2">
          <p className="text-center text-xs text-muted-foreground">{tn(level.confirmedSales, "{n} vente confirmée", "{n} ventes confirmées")}</p>
          {level.next && level.level > 0 && <ProgressBar percent={level.progressPercent} label={t("Vers le niveau {n}", { n: level.next.level })} />}
          <p className="text-center text-xs">
            {!level.next ? t("Dernier niveau atteint.")
              : level.level === 0 ? t("Termine la configuration de ton compte pour gagner le cadre {name}.", { name: levelLabel(1) })
              : t("{name} : {toGo}", { name: levelLabel(level.next.level), toGo: salesToGo(level.next.salesNeeded) })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Classeur des succès ─────────────────────────

/** Le liseré de la carte selon sa rareté (cartes obtenues seulement). */
const RARITY_FRAME: Record<AchievementRarity, string> = {
  common: "border border-border",
  uncommon: "border-2 border-[#a9b1b9]",
  rare: "border-2 border-[#c9971c]",
  holo: "border-2 border-transparent [background:linear-gradient(var(--card),var(--card))_padding-box,linear-gradient(135deg,#f18a1f,#8a4fe8,#3fa2f0,#3fd19a)_border-box]",
  secret: "border-2 border-transparent [background:linear-gradient(var(--card),var(--card))_padding-box,linear-gradient(135deg,#1d1a17,#c9971c,#1d1a17)_border-box]",
};

function CollectibleCard({ a, total }: { a: AchievementState; total: number }) {
  const unlocked = a.unlockedAt !== null;
  // Une carte secrète garde son nom tant qu'elle n'est pas obtenue ; sa condition, elle, reste visible.
  const hidden = !unlocked && a.rarity === "secret";
  const number = `${String(a.number).padStart(2, "0")}/${total}`;
  return (
    <li
      className={cn(
        "relative flex aspect-[63/88] flex-col overflow-hidden rounded-xl p-2.5 text-center",
        unlocked ? cn("bg-card shadow-sm", RARITY_FRAME[a.rarity]) : "border border-dashed border-border bg-muted/30",
      )}
      data-testid="achievement" data-unlocked={unlocked || undefined} data-rarity={a.rarity}
    >
      {unlocked && a.rarity === "holo" && (
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgb(255_255_255/0.35)_45%,rgb(160_200_255/0.25)_55%,transparent_70%)]" aria-hidden />
      )}
      <div className="flex items-center justify-between gap-1 text-[10px] font-medium whitespace-nowrap text-muted-foreground tabular">
        <span>{number}</span>
        <span className="truncate">{t(RARITY_LABEL[a.rarity])}</span>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <AchievementIcon category={a.category} unlocked={unlocked} className="size-10 rounded-xl sm:size-12 [&_svg]:size-5 sm:[&_svg]:size-6" />
      </div>
      <div className="grid gap-0.5">
        <span className={cn("line-clamp-2 text-xs leading-tight font-semibold sm:text-[13px]", !unlocked && "text-muted-foreground")}>{hidden ? "???" : t(a.name)}</span>
        <span className="line-clamp-3 text-[10px] leading-snug text-muted-foreground sm:text-[11px]" title={t(a.description)}>{t(a.description)}</span>
        <span className={cn("mt-1 text-[10px]", unlocked ? "text-brand" : "text-muted-foreground/70")}>
          {unlocked ? unlockedDate().format(new Date(a.unlockedAt!)) : t("À débloquer")}
        </span>
      </div>
    </li>
  );
}

const PAGE = 9;

/** Le classeur : les cartes de succès rangées par numéro, neuf par page ; une case vide tant que la carte manque. */
export function Binder({ achievements }: { achievements: AchievementState[] }) {
  const cards = [...achievements].sort((a, b) => a.number - b.number);
  const pages = Array.from({ length: Math.ceil(cards.length / PAGE) }, (_, i) => cards.slice(i * PAGE, (i + 1) * PAGE));
  const owned = cards.filter((c) => c.unlockedAt).length;
  return (
    <section className="grid gap-3" aria-label={t("Classeur")} data-testid="binder">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-xs font-medium text-muted-foreground">{t("Classeur")}</h2>
        <span className="text-xs text-muted-foreground tabular">{t("{owned} cartes sur {total}", { owned: formatNumber(owned), total: formatNumber(cards.length) })}</span>
      </div>
      <div className="grid gap-4">
        {pages.map((page, i) => (
          <div key={i} className="rounded-2xl border bg-muted/40 p-2.5 shadow-inner sm:p-4">
            <ul className="mx-auto grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
              {page.map((a) => <CollectibleCard key={a.id} a={a} total={cards.length} />)}
            </ul>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{t("Page {n} sur {total}", { n: i + 1, total: pages.length })}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────── Page Progression ─────────────────────────

export function ProgressDetails({ view }: { view: ProgressView }) {
  return (
    <div className="grid gap-6">
      <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <SellerCard level={view.level} shopName={view.shopName} />
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">
            {t("Le niveau ne dépend que des ventes confirmées (14 jours sans annulation, retour ni remboursement). Il ne descend jamais. Publier des annonces ne donne aucun point.")}
          </p>
          <ol className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="level-ladder">
            {view.levelNames.map((name, i) => (
              <li key={name} className={cn("flex justify-between gap-2", view.level.level === i + 1 && "font-semibold text-foreground")}>
                <span>{i + 1}. {t(name)}</span>
                <span className="tabular">{i === 0 ? t("Compte prêt") : formatNumber(levelThresholds[i]!)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <Binder achievements={view.achievements} />

      <section className="grid gap-2" aria-label={t("Avantages")}>
        <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("Avantages")}</h2>
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {Object.entries(levelPerks).flatMap(([level, perks]) => perks.map((perk) => (
            <li key={`${level}-${perk.kind}`} className={cn("flex items-center justify-between gap-3 px-4 py-2.5", view.level.level >= Number(level) ? "" : "text-muted-foreground")}>
              <span>{perk.kind === "beta" ? t("Accès anticipé aux fonctionnalités en test") : t("{n} cartes de bonus sur le mois en cours", { n: perk.cards })}</span>
              <span className="text-xs">{levelLabel(Number(level))}</span>
            </li>
          )))}
        </ul>
        <p className="px-1 text-xs text-muted-foreground">{t("Appliqués une seule fois, à l'atteinte du niveau. Les cartes de bonus n'existent que sur dexlane.app (pas en auto-hébergé).")}</p>
      </section>
    </div>
  );
}
