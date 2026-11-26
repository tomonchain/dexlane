"use client";

import { ArrowRight, Check, CircleCheckBig, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { OnboardingState } from "@/lib/insights";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Barre de progression sobre, avec sa valeur pour les lecteurs d'écran. */
export function ProgressBar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className={cn("h-2 overflow-hidden rounded-full bg-muted", className)}>
      <span className="block h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Les sept étapes, cochées d'après les données ; chaque étape qui reste a son bouton vers l'action. */
export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  return (
    <ol className="divide-y rounded-lg border bg-card" data-testid="onboarding-steps">
      {state.steps.map((step, i) => (
        <li key={step.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-done={step.done || undefined}>
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", step.done ? "border-transparent bg-success-soft text-success" : "text-muted-foreground")} aria-hidden>
            {step.done ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("min-w-0 flex-1 basis-48 text-sm", step.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>
            {t(step.title)}
            <span className="sr-only">{step.done ? ` — ${t("fait")}` : ` — ${t("à faire")}`}</span>
          </span>
          {!step.done && (
            <Button asChild size="sm" variant={state.next?.id === step.id ? "default" : "outline"}>
              <Link href={step.href}>{t(step.action)} <ArrowRight /></Link>
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * En haut de l'accueil : « Compte configuré à x % », la barre et la prochaine étape. « Masquer » l'ôte de l'accueil ; le
 * parcours reste dans le menu du compte. Une fois les sept étapes faites, un message de fin, puis le bloc disparaît.
 */
export function OnboardingBanner({ state, onHide }: { state: OnboardingState; onHide: () => void }) {
  if (state.complete) {
    return (
      <Card className="border-success/30 bg-success-soft/40" data-testid="onboarding-done">
        <CardContent className="flex items-start gap-3">
          <CircleCheckBig className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="grid flex-1 gap-1">
            <p className="text-sm font-semibold">{t("Ton compte est prêt")}</p>
            <p className="text-[13px] text-muted-foreground">{t("Les sept étapes sont faites : eBay connecté, stock rangé, première vente expédiée. Succès « Compte prêt » débloqué.")}</p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onHide} aria-label={t("Fermer")}><X /></Button>
        </CardContent>
      </Card>
    );
  }
  const next = state.next!;
  return (
    <Card data-testid="onboarding-banner">
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold" data-testid="onboarding-percent">{t("Compte configuré à {x} %", { x: state.percent })}</p>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/getting-started" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t("Voir les étapes")}</Link>
            <button type="button" onClick={onHide} className="text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">{t("Masquer")}</button>
          </div>
        </div>
        <ProgressBar percent={state.percent} label={t("Compte configuré à {x} %", { x: state.percent })} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-56 text-[13px]">
            <span className="text-muted-foreground">{t("Prochaine étape :")}</span> <span className="font-medium">{t(next.title)}</span>
          </p>
          <Button asChild size="sm"><Link href={next.href}>{t(next.action)} <ArrowRight /></Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}
