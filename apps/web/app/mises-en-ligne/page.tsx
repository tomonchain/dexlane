"use client";

import { CalendarClock, CircleCheck, Globe, Plug } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PlanModal } from "@/components/plan-modal";
import { SchedulePanel } from "@/components/schedule-panel";
import { ListSkeleton } from "@/components/skeletons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import type { ChannelState, Schedule, StockPage } from "@/lib/types";

/**
 * Mises en ligne : le planning jour par jour, les publications en échec, et ce qui attend encore d'être planifié.
 * Le stock ne garde que les cartes ; c'est ici qu'on décide quand elles partent sur les marketplaces.
 */
export default function PublicationsPage() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [stock, setStock] = useState<StockPage | null>(null);
  const [channels, setChannels] = useState<ChannelState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  const load = useCallback(() => {
    Promise.all([api.schedule(), api.stock({ limit: 1 }), api.channels()])
      .then(([sched, st, ch]) => {
        setSchedule(sched);
        setStock(st);
        setChannels(ch.channels.filter((c) => c.mode !== "OFF"));
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const ready = stock ? Math.max(stock.counts.READY - (schedule?.pending ?? 0), 0) : 0;
  const loaded = schedule && stock && channels;

  return (
    <Page>
      <PageHeader
        title={t("Mises en ligne")}
        description={t("Quand vos cartes partent sur eBay et CardTrader : le planning jour par jour, et ce qui n'a pas pu être publié.")}
        actions={loaded && channels.length > 0 && ready > 0 && (
          <Button onClick={() => setPlanning(true)}><CalendarClock /> {tn(ready, "Planifier {n} carte", "Planifier {n} cartes")}</Button>
        )}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!loaded && !error && <ListSkeleton count={4} label={t("Chargement du planning")} />}

      {loaded && (
        <>
          {channels.length === 0 && (
            <Alert variant="info">
              {t("Aucun canal de vente n'est actif : activez eBay ou CardTrader, en simulation pour tout essayer sans rien publier, dans")}{" "}
              <Link href="/reglages/canaux" className="font-medium underline underline-offset-2">{t("Réglages › Canaux de vente")}</Link>.
            </Alert>
          )}

          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border shadow-xs">
            <Figure icon={<CircleCheck />} label={t("Prêtes, non planifiées")} value={ready} href="/stock?statut=READY" />
            <Figure icon={<CalendarClock />} label={t("Planifiées")} value={schedule.pending} />
            <Figure icon={<Globe />} label={t("En ligne")} value={stock.counts.LISTED} href="/stock?statut=LISTED" />
          </div>

          {schedule.pending > 0 || schedule.failed.length > 0 ? (
            <SchedulePanel schedule={schedule} channels={channels} onChanged={load} />
          ) : (
            <EmptyState
              icon={channels.length > 0 ? <CalendarClock /> : <Plug />}
              title={t("Rien n'est planifié")}
              action={channels.length > 0 && ready > 0 && <Button size="sm" onClick={() => setPlanning(true)}>{t("Planifier les {n} cartes prêtes", { n: formatNumber(ready) })}</Button>}
            >
              {t("Planifiez les cartes prêtes pour les publier quelques-unes par jour, ou cochez-en dans le stock pour choisir lesquelles.")}
            </EmptyState>
          )}
        </>
      )}

      {planning && channels && stock && (
        <PlanModal
          channels={channels}
          selected={[]}
          readyCount={stock.counts.READY}
          onClose={() => setPlanning(false)}
          onPlanned={() => {
            setPlanning(false);
            load();
          }}
        />
      )}
    </Page>
  );
}

function Figure({ icon, label, value, href }: { icon: ReactNode; label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3.5">{icon} {label}</span>
      <span className="tabular text-lg leading-none font-semibold tracking-tight sm:text-2xl">{formatNumber(value)}</span>
    </>
  );
  return href
    ? <Link href={href} className="grid content-start gap-2 bg-card p-3 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent sm:p-4">{body}</Link>
    : <div className="grid content-start gap-2 bg-card p-3 sm:p-4">{body}</div>;
}
