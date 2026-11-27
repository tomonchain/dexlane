"use client";

import { OVERAGE_PACK } from "@dexlane/shared";
import { Check, Infinity as InfinityIcon, Minus, PackagePlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FEATURE_LABELS, FEATURE_ORDER, QuotaMeter, ScanMeter, useAccount } from "@/components/plan";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { BackLink, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime, formatEuros, formatNumber } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PlanId, PlanRule } from "@/lib/types";
import { cn } from "@/lib/utils";

const PACK = OVERAGE_PACK;

/** Réglages › Forfait : le quota du mois, les packs, et le changement de forfait. */
export default function PlanSettingsPage() {
  const { account, setAccount, error } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, action: () => Promise<Awaited<ReturnType<typeof api.account>>>, done: string) {
    setBusy(key);
    try {
      setAccount(await action());
      toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const choose = (plan: PlanRule) => {
    const down = account && plan.monthlyPriceEur < account.plan.monthlyPriceEur;
    const question = down
      ? t("Passer au forfait {plan} ? Il prend effet tout de suite ; tes annonces déjà en ligne ne bougent pas.", { plan: plan.name })
      : t("Passer au forfait {plan} ({price} par mois) ? Il prend effet tout de suite.", { plan: plan.name, price: formatEuros(plan.monthlyPriceEur * 100) });
    if (!window.confirm(question)) return;
    void act(plan.id, () => api.changePlan(plan.id as Exclude<PlanId, "community">), t("Forfait {plan} activé", { plan: plan.name }));
  };

  const unlimited = account?.plan.cardsPerMonth === null;
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/settings">Réglages</BackLink>}
        title={t("Forfait")}
        description={t("Tu paies selon les cartes que tu publies, jamais sur ce que tu vends. Modifier un prix, mettre à jour une quantité ou remettre une annonce en ligne ne compte pas ; un lot compte pour une carte.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!account ? !error && <Loading /> : (
        <>
          <Card data-testid="plan-current">
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{t("Forfait {plan}", { plan: account.plan.name })}</CardTitle>
                {unlimited ? <Badge variant="success"><InfinityIcon /> {t("sans limite")}</Badge>
                  : <Badge variant="outline">{account.plan.monthlyPriceEur === 0 ? t("gratuit") : t("{price} / mois", { price: formatEuros(account.plan.monthlyPriceEur * 100) })}</Badge>}
              </div>
              <QuotaMeter quota={account.quota} />
              <ScanMeter scans={account.scans} />
              {account.scans.remaining === 0 && (
                <Alert variant="destructive">{t("Scans du mois épuisés : la lecture automatique reprend avec un pack, un forfait supérieur ou le mois prochain. Les cartes se recherchent toujours à la main.")}</Alert>
              )}
              {!unlimited && account.quota.remaining !== null && account.quota.limit !== null && account.quota.remaining <= account.quota.limit * 0.2 && (
                <Alert variant={account.quota.remaining === 0 ? "destructive" : "warning"}>
                  {account.quota.remaining === 0
                    ? t("Quota atteint : les nouvelles publications attendent un pack ou un forfait supérieur. Une mise en ligne planifiée déjà commencée va au bout.")
                    : t("Plus que {n} cartes à publier ce mois-ci.", { n: formatNumber(account.quota.remaining) })}
                </Alert>
              )}
              {!unlimited && (
                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                  <div className="grid flex-1 gap-0.5">
                    <p className="text-sm font-medium">{t("Pack de {n} cartes et {scans} scans", { n: formatNumber(PACK.cards), scans: formatNumber(PACK.scans) })}</p>
                    <p className="text-[13px] text-muted-foreground">{t("{price}, valable jusqu'à la fin du mois. Sur un forfait payant, une mise en ligne planifiée qui dépasse ajoute d'elle-même les packs nécessaires.", { price: formatEuros(PACK.priceEur * 100) })}</p>
                  </div>
                  <Button variant="outline" disabled={!account.isOwner || busy !== null} onClick={() => act("pack", () => api.addPacks(1), t("Pack ajouté : {n} cartes et {scans} scans de plus ce mois-ci", { n: formatNumber(PACK.cards), scans: formatNumber(PACK.scans) }))} data-testid="add-pack">
                    {busy === "pack" ? <Spinner /> : <PackagePlus />} {t("Ajouter un pack")}
                  </Button>
                </div>
              )}
              {account.quota.packs.length > 0 && (
                <ul className="grid gap-1 text-[13px] text-muted-foreground">
                  {account.quota.packs.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>{p.automatic ? t("Pack ajouté automatiquement") : t("Pack ajouté")} · {formatDateTime(p.createdAt)}</span>
                      <span className="tabular">{t("{n} cartes", { n: formatNumber(p.cards) })} · {formatEuros(p.priceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!account.isOwner && <p className="text-[13px] text-muted-foreground">{t("Seul le propriétaire du compte change le forfait et ajoute des packs.")}</p>}
            </CardContent>
          </Card>

          {!unlimited && (
            <section className="grid gap-3" aria-label={t("Forfaits")}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {account.plans.map((plan) => {
                  const current = plan.id === account.plan.id;
                  const requested = account.requestedPlan === plan.id && !current;
                  return (
                    <li key={plan.id} className={cn("grid content-start gap-3 rounded-lg border bg-card p-4", current && "border-primary ring-1 ring-primary")} data-testid={`plan-option-${plan.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-[15px] font-semibold">{plan.name}</h2>
                        {current ? <Badge variant="brand">{t("Forfait actuel")}</Badge> : requested ? <Badge variant="outline">{t("Choisi à l'inscription")}</Badge> : null}
                      </div>
                      <p className="text-sm">
                        <span className="text-xl font-semibold tracking-tight">{plan.monthlyPriceEur === 0 ? t("Gratuit") : formatEuros(plan.monthlyPriceEur * 100)}</span>
                        {plan.monthlyPriceEur > 0 && <span className="text-muted-foreground"> {t("par mois")}</span>}
                      </p>
                      <p className="tabular text-[13px] text-muted-foreground">
                        {t("{n} cartes publiées par mois", { n: formatNumber(plan.cardsPerMonth ?? 0) })}
                        <br />{t("{n} scans par mois", { n: formatNumber(plan.scansPerMonth ?? 0) })}
                      </p>
                      <ul className="grid gap-1.5 text-[13px]">
                        {FEATURE_ORDER.map((f) => {
                          const included = plan.features.includes(f);
                          return (
                            <li key={f} className={cn("flex items-start gap-2", !included && "text-muted-foreground/70")}>
                              {included ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label={t("Inclus")} /> : <Minus className="mt-0.5 size-3.5 shrink-0" aria-label={t("Non inclus")} />}
                              {t(FEATURE_LABELS[f])}
                            </li>
                          );
                        })}
                      </ul>
                      {!current && (
                        <Button variant={plan.monthlyPriceEur > account.plan.monthlyPriceEur ? "default" : "outline"} size="sm" disabled={!account.isOwner || busy !== null} onClick={() => choose(plan)}>
                          {busy === plan.id && <Spinner />} {plan.monthlyPriceEur > account.plan.monthlyPriceEur ? t("Passer à {plan}", { plan: plan.name }) : t("Revenir à {plan}", { plan: plan.name })}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="text-[13px] text-muted-foreground">{t("Sans engagement : tu changes de forfait ou reviens au forfait gratuit quand tu veux. Aucune commission sur tes ventes.")}</p>
            </section>
          )}
          {unlimited && (
            <Card>
              <CardContent className="grid gap-2">
                <CardTitle>{t("Installation sans limite")}</CardTitle>
                <CardDescription>{t("Ce compte est celui de l'installation (ou les forfaits sont coupés sur ce serveur) : toutes les fonctionnalités, sans quota de cartes.")}</CardDescription>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
