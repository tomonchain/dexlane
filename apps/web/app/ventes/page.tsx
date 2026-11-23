"use client";

import { ChevronRight, CircleDollarSign, Plus, Printer, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Code, EmptyState, PageHeader } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatDateTime, formatEuros } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { SHIPPING_LABEL } from "@/lib/sales";
import type { OrderList, OrderStage } from "@/lib/types";
import { SalesSkeleton, SalesTotalsSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";

const EMPTY: Record<OrderStage, [string, string]> = {
  TO_PREPARE: ["Rien à préparer", "Les ventes enregistrées apparaissent ici tant que les cartes ne sont pas emballées."],
  PACKED: ["Aucune vente emballée", "Une vente emballée attend d'être déposée ou remise à l'acheteur."],
  SHIPPED: ["Aucune vente remise", "Les ventes déposées ou remises en main propre s'affichent ici."],
  CANCELLED: ["Aucune vente annulée", ""],
};

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="grid content-start gap-1.5 bg-card p-3 sm:gap-2 sm:p-4">
      <div className="flex items-start justify-between gap-2 text-muted-foreground">
        <span className="text-xs font-medium sm:text-[13px]">{label}</span>
        <span className="hidden sm:block [&_svg]:size-4">{icon}</span>
      </div>
      <div className="tabular text-lg leading-none font-semibold tracking-tight sm:text-2xl">{value}</div>
      <div className="hidden text-xs text-muted-foreground sm:block">{hint}</div>
    </div>
  );
}

const CHANNEL_LABEL: Record<string, string> = { ebay: "eBay", cardtrader: "CardTrader" };

export default function SalesPage() {
  const [stage, setStage] = useState<OrderStage>("TO_PREPARE");
  const [data, setData] = useCachedState<OrderList>(`orders:${stage}`, { keepPrevious: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setData((d) => (d ? { ...d, items: [] } : d));
    api.orders(stage)
      .then((r) => current && (setData(r), setError(null)))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [stage]);

  const totals = data?.last30Days;
  return (
    <div className="grid gap-5">
      <PageHeader
        title={t("Ventes")}
        description={t("Ventes directes : les cartes sont réservées à l'enregistrement, puis prélevées, emballées et remises.")}
        actions={<>
          <Button asChild variant="outline"><Link href="/ventes/preparation"><Printer /> {t("Préparer les envois")}</Link></Button>
          <Button asChild><Link href="/ventes/nouvelle"><Plus /> {t("Nouvelle vente")}</Link></Button>
        </>}
      />

      {!data && !error && <SalesTotalsSkeleton />}
      {totals && (
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border shadow-xs">
          <Stat icon={<ShoppingBag />} label={t("Ventes remises (30 j)")} value={String(totals.orders)} hint={t("déposées ou remises en main propre")} />
          <Stat icon={<CircleDollarSign />} label={t("Encaissé (30 j)")} value={formatEuros(totals.grossCents)} hint={t("frais de port facturés compris")} />
          <Stat icon={<TrendingUp />} label={t("Marge (30 j)")} value={formatEuros(totals.marginCents)} hint={t("après {cost} de cartes, {postage} d'affranchissement et {supplies} de fournitures", { cost: formatEuros(totals.costCents), postage: formatEuros(totals.postageCents), supplies: formatEuros(totals.suppliesCents) })} />
        </div>
      )}

      <div>
        <SegmentedTabs
          label={t("Étape")}
          value={stage}
          onChange={setStage}
          tabs={[
            { value: "TO_PREPARE", label: t("À préparer"), count: data?.counts.TO_PREPARE },
            { value: "PACKED", label: t("Emballées"), count: data?.counts.PACKED },
            { value: "SHIPPED", label: t("Remises"), count: data?.counts.SHIPPED },
            { value: "CANCELLED", label: t("Annulées"), count: data?.counts.CANCELLED },
          ]}
        />
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <SalesSkeleton />}
      {data && data.items.length === 0 && data.counts[stage] === 0 && (
        <EmptyState icon={<Receipt />} title={t(EMPTY[stage][0])} action={stage === "TO_PREPARE" && <Button asChild size="sm"><Link href="/ventes/nouvelle">{t("Enregistrer une vente")}</Link></Button>}>
          {EMPTY[stage][1] ? t(EMPTY[stage][1]) : undefined}
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <Card className="divide-y overflow-hidden">
          {data.items.map((o) => (
            <Link key={o.id} href={`/ventes/${o.id}`} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent sm:px-5" data-testid={`order-${o.externalId}`}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Code className="text-sm font-semibold">{o.externalId}</Code>
                  {o.channel !== "direct" && <Badge variant="brand">{CHANNEL_LABEL[o.channel] ?? o.channel}</Badge>}
                  {o.oversold && <Badge variant="destructive">{t("Survente")}</Badge>}
                  {o.buyerName && <span className="truncate text-sm">{o.buyerName}</span>}
                  {o.shippingMode && <Badge variant="outline">{t(SHIPPING_LABEL[o.shippingMode])}</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {o.cardNames.join(", ")}{o.cards > o.cardNames.length ? "…" : ""} · {tn(o.cards, "{n} carte", "{n} cartes")} · {formatDateTime(o.orderedAt)}
                </span>
              </span>
              <span className="tabular text-sm font-semibold">{formatEuros(o.grossCents)}</span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
