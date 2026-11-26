"use client";

import { Download, Share2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ProgressBar } from "@/components/insights/onboarding";
import { AchievementIcon } from "@/components/insights/progress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { SwitchRow } from "@/components/ui/switch";
import { SegmentedTabs } from "@/components/ui/tabs";
import { achievements as ACHIEVEMENTS, minutesSavedPerListing } from "@dexlane/insights/config";
import { dateFormat, formatNumber } from "@/lib/format";
import { formatAmount, formatAmounts, formatMinutes, insights, levelLabel, periodName, salesToGo, type RecapView } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = () => dateFormat({ day: "numeric", month: "long" });

function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="grid content-start gap-1 bg-card px-4 py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular text-2xl leading-none font-semibold tracking-tight">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Récap d'un mois (« 2026-10 ») ou d'une année (« 2026 ») (#85). */
export default function RecapPage() {
  const { period } = useParams<{ period: string }>();
  const [view, setView] = useState<RecapView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  useEffect(() => {
    insights.recap(period).then(setView).catch((e: Error) => setError(e.message));
  }, [period]);

  const r = view?.data;
  const yearly = r?.kind === "year";
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader back={<BackLink href="/recap">{t("Récaps")}</BackLink>}
        title={r ? (yearly ? t("Année {year}", { year: r.period }) : capitalize(periodName(r.period))) : t("Récap")}
        description={yearly ? t("Ton année sur Dexlane.") : t("Ton mois sur Dexlane.")}
        actions={view && <Button onClick={() => setSharing(true)} data-testid="recap-share"><Share2 /> {t("Partager")}</Button>} />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!view && !error && <Loading />}
      {r && (
        <div className="grid gap-5" data-testid="recap">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
            <Figure label={t("Cartes publiées")} value={formatNumber(r.listingsPublished)} />
            <Figure label={t("Cartes vendues")} value={formatNumber(r.cardsSold)} />
            <Figure label={t("Chiffre d'affaires")} value={r.revenue.length ? formatAmounts(r.revenue, { maximumFractionDigits: 0 }) : "—"} />
            <Figure label={t("Temps gagné")} value={formatMinutes(r.timeSavedMinutes)} hint={t("Estimation : {n} minutes par annonce publiée via Dexlane", { n: minutesSavedPerListing })} />
          </dl>

          <Card>
            <CardContent className="grid gap-3 text-sm">
              {r.bestSale && (
                <p><span className="text-muted-foreground">{t("Meilleure vente :")}</span> <span className="font-medium">{r.bestSale.name}</span>{r.bestSale.setName ? ` (${r.bestSale.setName})` : ""}, {formatAmount({ currency: r.bestSale.currency, cents: r.bestSale.unitPriceCents })}</p>
              )}
              {r.fastestSale && (
                <p><span className="text-muted-foreground">{t("Vendue le plus vite :")}</span> <span className="font-medium">{r.fastestSale.name}</span>, {r.fastestSale.days < 1 ? t("moins d'un jour après sa mise en ligne") : tn(Math.round(r.fastestSale.days), "{n} jour après sa mise en ligne", "{n} jours après sa mise en ligne")}</p>
              )}
              {yearly && r.recordMonth && (
                <p><span className="text-muted-foreground">{t("Mois record :")}</span> <span className="font-medium first-letter:uppercase">{periodName(r.recordMonth.month)}</span>, {tn(r.recordMonth.cards, "{n} carte vendue", "{n} cartes vendues")}</p>
              )}
              {!r.bestSale && !r.fastestSale && <p className="text-muted-foreground">{t("Pas de vente sur la période, mais des cartes publiées : la suite au prochain récap.")}</p>}
            </CardContent>
          </Card>

          {view.showProgression && r.level && (
            <Card>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-[15px] font-semibold tracking-tight">{r.level.level > 0 ? levelLabel(r.level.level) : t("Pas encore de niveau")}</h2>
                    {r.level.next && <span className="text-[13px] text-muted-foreground">{salesToGo(r.level.next.salesNeeded)}</span>}
                  </div>
                  {r.level.next && <ProgressBar percent={r.level.progressPercent} label={t("Vers le niveau {n}", { n: r.level.next.level })} />}
                </div>
                <div className="grid gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {yearly ? tn(r.achievementsCount, "{n} succès débloqué cette année", "{n} succès débloqués cette année") : tn(r.achievementsCount, "{n} succès débloqué ce mois-ci", "{n} succès débloqués ce mois-ci")}
                  </p>
                  {r.achievements.length > 0 && (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {r.achievements.map((a) => (
                        <li key={a.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                          <AchievementIcon category={ACHIEVEMENTS.find((d) => d.id === a.id)?.category ?? "start"} unlocked className="size-8" />
                          <span className="grid text-sm"><span className="font-medium">{t(a.name)}</span><span className="text-xs text-muted-foreground">{longDate().format(new Date(a.unlockedAt))}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {sharing && view && <ShareModal view={view} onClose={() => setSharing(false)} />}
    </Page>
  );
}

/**
 * Partager : rien ne sort sans cette action. Par défaut, aucun montant ni nom de boutique ; l'image est générée sur le
 * serveur au moment où on la demande, et n'est conservée nulle part.
 */
function ShareModal({ view, onClose }: { view: RecapView; onClose: () => void }) {
  const [format, setFormat] = useState<"post" | "story">("post");
  const [revenue, setRevenue] = useState(false);
  const [shop, setShop] = useState(false);
  const [referral, setReferral] = useState(view.referral !== null);
  const [url, setUrl] = useState<string | null>(null);
  const query = new URLSearchParams({ format, revenue: revenue ? "1" : "0", shop: shop ? "1" : "0", referral: referral ? "1" : "0" });
  const href = `/recap/${view.period}/image?${query}`;
  const reset = () => setUrl(null);
  return (
    <Modal title={t("Partager mon récap")} description={t("Une image à publier où tu veux. Aucune image de carte, et rien d'autre que ce que tu choisis ici.")} onClose={onClose}>
      <SegmentedTabs label={t("Format")} value={format} onChange={(f) => { setFormat(f); reset(); }}
        tabs={[{ value: "post", label: t("Publication (1080 × 1350)") }, { value: "story", label: t("Story (1080 × 1920)") }]} />
      <div className="grid gap-1">
        <SwitchRow label={t("Afficher mon chiffre d'affaires")} checked={revenue} onCheckedChange={(v) => { setRevenue(v); reset(); }} />
        {view.shopName && <SwitchRow label={t("Afficher le nom de ma boutique")} description={view.shopName} checked={shop} onCheckedChange={(v) => { setShop(v); reset(); }} />}
        {view.referral && <SwitchRow label={t("Ajouter mon lien de parrainage")} checked={referral} onCheckedChange={(v) => { setReferral(v); reset(); }} />}
      </div>
      {url ? (
        <div className="grid gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- image générée à la demande, jamais optimisée ni mise en cache */}
          <img src={url} alt={t("Aperçu de l'image de partage")} className="mx-auto max-h-[50dvh] w-auto rounded-lg border" data-testid="share-preview" />
          <Button asChild><a href={url} download={`dexlane-recap-${view.period}-${format}.png`}><Download /> {t("Télécharger l'image")}</a></Button>
        </div>
      ) : (
        <Button onClick={() => setUrl(href)} data-testid="share-generate">{t("Générer l'image")}</Button>
      )}
    </Modal>
  );
}
