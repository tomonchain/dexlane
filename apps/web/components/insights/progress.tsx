"use client";

import type { AchievementCategory } from "@dexlane/insights/config";
import { levelPerks } from "@dexlane/insights/config";
import { dateFormat } from "@/lib/format";
import { levelLabel, salesToGo, type AchievementState, type LevelState, type ProgressView } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "./onboarding";

/**
 * Icônes des succès : un jeu sobre et géométrique, une forme par catégorie. Rien qui évoque un jeu de cartes, ni
 * badge, ni personnage.
 */
const SHAPES: Record<AchievementCategory, (props: { className?: string }) => React.ReactElement> = {
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

/** Niveau du compte et barre vers le suivant. */
export function LevelCard({ level, names = [] }: { level: LevelState; names?: string[] }) {
  return (
    <Card data-testid="level-card">
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-lg font-semibold tracking-tight" data-testid="level-label">{level.level > 0 ? levelLabel(level.level, names) : t("Pas encore de niveau")}</p>
          <p className="text-[13px] text-muted-foreground">{tn(level.confirmedSales, "{n} vente confirmée", "{n} ventes confirmées")}</p>
        </div>
        {level.next ? (
          <>
            <ProgressBar percent={level.progressPercent} label={t("Vers le niveau {n}", { n: level.next.level })} />
            <p className="text-[13px] text-muted-foreground">
              {level.level === 0
                ? t("Termine le démarrage ou fais ta première vente pour atteindre le niveau 1.")
                : t("{levelLabel} : {toGo}", { levelLabel: levelLabel(level.next.level, names), toGo: salesToGo(level.next.salesNeeded) })}
            </p>
          </>
        ) : <p className="text-[13px] text-muted-foreground">{t("Dernier niveau atteint.")}</p>}
        <p className="text-xs text-muted-foreground">{t("Le niveau ne dépend que des ventes confirmées (14 jours sans annulation, retour ni remboursement). Il ne descend jamais. Publier des annonces ne donne aucun point.")}</p>
      </CardContent>
    </Card>
  );
}

function Achievement({ a }: { a: AchievementState }) {
  const unlocked = a.unlockedAt !== null;
  return (
    <li className={cn("flex items-start gap-3 rounded-lg border bg-card p-3", !unlocked && "bg-muted/30")} data-testid="achievement" data-unlocked={unlocked || undefined}>
      <AchievementIcon category={a.category} unlocked={unlocked} />
      <span className="grid min-w-0 gap-0.5">
        <span className={cn("text-sm font-medium", !unlocked && "text-muted-foreground")}>{t(a.name)}</span>
        <span className="text-xs text-muted-foreground">{t(a.description)}</span>
        {unlocked && <span className="text-xs text-brand">{t("Débloqué le {date}", { date: unlockedDate().format(new Date(a.unlockedAt!)) })}</span>}
      </span>
    </li>
  );
}

export function ProgressDetails({ view }: { view: ProgressView }) {
  return (
    <div className="grid gap-6">
      <LevelCard level={view.level} names={view.levelNames} />

      {view.recent.length > 0 && (
        <section className="grid gap-2" aria-label={t("Succès récents")}>
          <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("Succès récents")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">{view.recent.map((a) => <Achievement key={a.id} a={a} />)}</ul>
        </section>
      )}

      {view.categories.map((c) => {
        const items = view.achievements.filter((a) => a.category === c.id);
        if (items.length === 0) return null;
        return (
          <section key={c.id} className="grid gap-2" aria-label={t(c.label)}>
            <h2 className="px-1 text-xs font-medium text-muted-foreground">{t(c.label)}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">{items.map((a) => <Achievement key={a.id} a={a} />)}</ul>
          </section>
        );
      })}

      <section className="grid gap-2" aria-label={t("Avantages")}>
        <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("Avantages")}</h2>
        <ul className="divide-y rounded-lg border bg-card text-sm">
          {Object.entries(levelPerks).flatMap(([level, perks]) => perks.map((perk) => (
            <li key={`${level}-${perk.kind}`} className={cn("flex items-center justify-between gap-3 px-4 py-2.5", view.level.level >= Number(level) ? "" : "text-muted-foreground")}>
              <span>{perk.kind === "beta" ? t("Accès anticipé aux fonctionnalités en test") : t("{n} cartes de bonus sur le mois en cours", { n: perk.cards })}</span>
              <span className="text-xs">{levelLabel(Number(level), view.levelNames)}</span>
            </li>
          )))}
        </ul>
        <p className="px-1 text-xs text-muted-foreground">{t("Appliqués une seule fois, à l'atteinte du niveau. Les cartes de bonus n'existent que sur dexlane.app (pas en auto-hébergé).")}</p>
      </section>
    </div>
  );
}
