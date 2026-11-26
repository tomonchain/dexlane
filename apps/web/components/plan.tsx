"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { AccountSummary, PlanFeature } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Ce que comprend chaque forfait, dans l'ordre de la grille. */
export const FEATURE_LABELS: Record<PlanFeature, string> = {
  ebay: "Connexion eBay en un clic",
  bulk: "Publication en masse",
  sync: "Synchronisation des prix et du stock",
  suggestions: "Suggestions de titre et de prix",
  team: "Plusieurs utilisateurs",
  support: "Support prioritaire",
};
export const FEATURE_ORDER: PlanFeature[] = ["ebay", "bulk", "sync", "suggestions", "team", "support"];

/** Le forfait le moins cher qui comprend la fonctionnalité. */
export const planFor = (account: AccountSummary, feature: PlanFeature) => account.plans.find((p) => p.features.includes(feature)) ?? null;

/** Le compte, son forfait et son quota (lus une fois par écran). */
export function useAccount(version = 0) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.account().then(setAccount).catch((e: Error) => setError(e.message));
  }, [version]);
  return { account, setAccount, error };
}

/** Jauge du quota du mois : cartes publiées sur la limite (forfait + packs). */
export function QuotaMeter({ quota, className }: { quota: AccountSummary["quota"]; className?: string }) {
  if (quota.limit === null) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)} data-testid="quota-meter">
        {t("{n} cartes publiées ce mois-ci, sans limite.", { n: formatNumber(quota.used) })}
      </p>
    );
  }
  const ratio = quota.limit === 0 ? 1 : Math.min(1, quota.used / quota.limit);
  const tone = ratio >= 1 ? "bg-destructive" : ratio >= 0.8 ? "bg-warning" : "bg-primary";
  return (
    <div className={cn("grid gap-1.5", className)} data-testid="quota-meter">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span><strong className="tabular font-semibold">{formatNumber(quota.used)}</strong> <span className="text-muted-foreground">{t("sur {limit} cartes publiées ce mois-ci", { limit: formatNumber(quota.limit) })}</span></span>
        <span className="tabular text-[13px] text-muted-foreground">{t("{n} restantes", { n: formatNumber(quota.remaining ?? 0) })}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={quota.limit} aria-valuenow={quota.used} aria-label={t("Quota du mois")}>
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      {quota.packCards > 0 && (
        <p className="text-[13px] text-muted-foreground">{t("dont {n} cartes de packs ajoutés ce mois-ci", { n: formatNumber(quota.packCards) })}</p>
      )}
    </div>
  );
}

/** Une fonctionnalité que le forfait ne comprend pas : ce qu'elle fait, et le forfait qui l'ouvre. */
export function LockedFeature({ feature, account, children, className }: { feature: PlanFeature; account: AccountSummary | null; children?: React.ReactNode; className?: string }) {
  const plan = account ? planFor(account, feature) : null;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-md border border-dashed px-3 py-2.5 text-[13px]", className)} data-testid={`locked-${feature}`}>
      <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid gap-1">
        <p><span className="font-medium">{t(FEATURE_LABELS[feature])}</span>{plan && <span className="text-muted-foreground"> · {t("forfait {plan} et plus", { plan: plan.name })}</span>}</p>
        {children && <p className="text-muted-foreground">{children}</p>}
        <Link href="/settings/plan" className="justify-self-start font-medium underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring/40">{t("Voir les forfaits")}</Link>
      </div>
    </div>
  );
}

export const hasFeature = (account: AccountSummary | null, feature: PlanFeature) => !!account?.plan.features.includes(feature);
