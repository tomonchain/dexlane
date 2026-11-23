"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { dayLabel, formatNumber } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import type { ChannelState, Schedule } from "@/lib/types";

const PLAN_ERRORS: Record<string, string> = {
  LISTING_NOT_READY: "prix, photo ou variante manquante",
  OFFER_NOT_SELLABLE: "plus de stock vendable",
  CHANNEL_DISABLED: "canal désactivé",
  CHANNEL_NOT_CONFIGURED: "connecteur du canal non configuré",
};
const message = (e: unknown) => (e instanceof ApiError ? e.message : (e as Error).message);

/** Le planning des mises en ligne : jour par jour et canal par canal, avec les échecs à reprendre. */
export function SchedulePanel({ schedule, channels, onChanged }: { schedule: Schedule; channels: ChannelState[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const label = (id: string) => channels.find((c) => c.id === id)?.label ?? id;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      toast.success(await action());
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  }
  const due = schedule.days.filter((d) => d.plannedOn <= today).reduce((sum, d) => sum + d.count, 0);
  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label={t("Planning des mises en ligne")} data-testid="schedule">
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/50 px-4 py-2">
        <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-[13px] font-medium">
          {t("{what} sur {days}", {
            what: tn(schedule.pending, "{n} mise en ligne planifiée", "{n} mises en ligne planifiées"),
            days: tn(schedule.days.length, "{n} jour", "{n} jours"),
          })}
        </h2>
        {due > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => {
            const r = await api.runPublications();
            return tn(r.published, "{n} annonce publiée", "{n} annonces publiées") + (r.failed ? t(", {n} en échec", { n: formatNumber(r.failed) }) : "");
          })}>
            {t("Publier maintenant les {n} du jour", { n: formatNumber(due) })}
          </Button>
        )}
      </div>
      <ul className="divide-y text-sm">
        {schedule.days.map((d) => (
          <li key={`${d.plannedOn}-${d.channel}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
            <span className="w-28 font-medium first-letter:uppercase">{dayLabel(d.plannedOn)}</span>
            <span className="tabular w-36 text-muted-foreground">{tn(d.count, "{n} carte", "{n} cartes")} · {label(d.channel)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{d.cardNames.join(", ")}{d.count > d.cardNames.length ? "…" : ""}</span>
            <Button variant="ghost" size="sm" disabled={busy} aria-label={t("Annuler les mises en ligne du {day}", { day: dayLabel(d.plannedOn) })} onClick={() => run(async () => {
              const r = await api.cancelPublications({ plannedOn: d.plannedOn, channel: d.channel });
              return tn(r.cancelled, "{n} mise en ligne annulée", "{n} mises en ligne annulées");
            })}>
              {t("Annuler")}
            </Button>
          </li>
        ))}
        {schedule.failed.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[13px]">
            <span className="size-2 rounded-full bg-destructive" aria-hidden />
            <span className="flex-1">
              <strong className="font-medium">{f.cardName}</strong>{" "}
              {t("n'a pas pu être publiée {day} : {error}.", { day: dayLabel(f.plannedOn), error: t(PLAN_ERRORS[f.errorCode ?? ""] ?? "erreur du canal") })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
