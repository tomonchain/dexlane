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
import { SHIPPING_LABEL } from "@/lib/sales";
import type { OrderList, OrderStage } from "@/lib/types";
import { SalesSkeleton, SalesTotalsSkeleton } from "@/components/skeletons";

const EMPTY: Record<OrderStage, [string, string]> = {
  TO_PREPARE: ["Rien à préparer", "Les ventes enregistrées apparaissent ici tant que les cartes ne sont pas emballées."],
  PACKED: ["Aucune vente emballée", "Une vente emballée attend d'être déposée ou remise à l'acheteur."],
  SHIPPED: ["Aucune vente remise", "Les ventes déposées ou remises en main propre s'affichent ici."],
  CANCELLED: ["Aucune vente annulée", ""],
};

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <Card className="grid gap-2 p-4">
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="[&_svg]:size-4">{icon}</span>
      </div>
      <div className="tabular text-2xl leading-none font-semibold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </Card>
  );
}

const CHANNEL_LABEL: Record<string, string> = { ebay: "eBay", cardtrader: "CardTrader" };

export default function SalesPage() {
  const [stage, setStage] = useState<OrderStage>("TO_PREPARE");
  const [data, setData] = useState<OrderList | null>(null);
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
        title="Ventes"
        description="Ventes directes : les cartes sont réservées à l'enregistrement, puis prélevées, emballées et remises."
        actions={<>
          <Button asChild variant="outline"><Link href="/ventes/preparation"><Printer /> Préparer les envois</Link></Button>
          <Button asChild><Link href="/ventes/nouvelle"><Plus /> Nouvelle vente</Link></Button>
        </>}
      />

      {!data && !error && <SalesTotalsSkeleton />}
      {totals && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat icon={<ShoppingBag />} label="Ventes remises (30 j)" value={String(totals.orders)} hint="déposées ou remises en main propre" />
          <Stat icon={<CircleDollarSign />} label="Encaissé (30 j)" value={formatEuros(totals.grossCents)} hint="frais de port facturés compris" />
          <Stat icon={<TrendingUp />} label="Marge (30 j)" value={formatEuros(totals.marginCents)} hint={`après ${formatEuros(totals.costCents)} de cartes et ${formatEuros(totals.postageCents)} d'affranchissement`} />
        </div>
      )}

      <div className="overflow-x-auto">
        <SegmentedTabs
          label="Étape"
          value={stage}
          onChange={setStage}
          tabs={[
            { value: "TO_PREPARE", label: "À préparer", count: data?.counts.TO_PREPARE },
            { value: "PACKED", label: "Emballées", count: data?.counts.PACKED },
            { value: "SHIPPED", label: "Remises", count: data?.counts.SHIPPED },
            { value: "CANCELLED", label: "Annulées", count: data?.counts.CANCELLED },
          ]}
        />
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <SalesSkeleton />}
      {data && data.items.length === 0 && data.counts[stage] === 0 && (
        <EmptyState icon={<Receipt />} title={EMPTY[stage][0]} action={stage === "TO_PREPARE" && <Button asChild size="sm"><Link href="/ventes/nouvelle">Enregistrer une vente</Link></Button>}>
          {EMPTY[stage][1] || undefined}
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
                  {o.oversold && <Badge variant="destructive">Survente</Badge>}
                  {o.buyerName && <span className="truncate text-sm">{o.buyerName}</span>}
                  {o.shippingMode && <Badge variant="outline">{SHIPPING_LABEL[o.shippingMode]}</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                  {o.cardNames.join(", ")}{o.cards > o.cardNames.length ? "…" : ""} · {o.cards} carte{o.cards > 1 ? "s" : ""} · {formatDateTime(o.orderedAt)}
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
