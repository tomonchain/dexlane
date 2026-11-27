"use client";

import { CalendarClock, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PLAN_ERRORS } from "@/components/schedule-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Code, Loading, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { api } from "@/lib/api";
import { useCachedState } from "@/lib/cache";
import { dateFormat, formatEuros, formatNumber } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import type { ChannelState, PublicationCalendar, PublicationDay } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<PublicationDay["entries"][number]["status"], { label: string; variant: "brand" | "success" | "destructive" | "outline" }> = {
  PENDING: { label: "Prévue", variant: "brand" },
  DONE: { label: "Publiée", variant: "success" },
  PUBLISHED: { label: "Publiée à la main", variant: "success" },
  FAILED: { label: "En échec", variant: "destructive" },
};

const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (day: string) => new Date(`${day}T12:00:00Z`);
function addDays(day: string, n: number) {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
/** Les six semaines (lundi → dimanche) qui couvrent le mois « AAAA-MM ». */
function monthGrid(month: string): string[] {
  const first = at(`${month}-01`);
  const start = addDays(iso(first), -((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
function shiftMonth(month: string, n: number) {
  const d = at(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d).slice(0, 7);
}

/**
 * Calendrier des mises en ligne : chaque jour, ce qui est prévu (par canal), ce qui a été publié et ce qui a échoué.
 * Un jour s'ouvre carte par carte : déplacer une carte à un autre jour, l'annuler, replanifier un échec.
 */
export function PublicationCalendarView({ channels, onChanged }: { channels: ChannelState[]; onChanged: () => void }) {
  const today = todayParis();
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = monthGrid(month);
  const [data, setData] = useCachedState<PublicationCalendar>(`publications:calendar:${month}`, { keepPrevious: true });
  const [open, setOpen] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.publicationCalendar(days[0]!, days[41]!).then(setData).catch((e: Error) => toast.error(e.message));
  }, [month, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const label = (id: string) => channels.find((c) => c.id === id)?.label ?? id;
  const weekdays = days.slice(0, 7).map((d) => dateFormat({ weekday: "short", timeZone: "UTC" }).format(at(d)).replace(/\.$/, ""));
  const title = dateFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(at(`${month}-01`));
  const planned = (data?.days ?? []).filter((d) => d.date.startsWith(month)).reduce((n, d) => n + Object.values(d.planned).reduce((a, b) => a + (b ?? 0), 0), 0);
  const published = (data?.days ?? []).filter((d) => d.date.startsWith(month)).reduce((n, d) => n + d.published, 0);

  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label={t("Calendrier des mises en ligne")} data-testid="publication-calendar">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold first-letter:uppercase" data-testid="calendar-month">{title}</h2>
        <span className="text-xs text-muted-foreground max-sm:basis-full max-sm:order-last">
          {tn(planned, "{n} prévue", "{n} prévues")} · {tn(published, "{n} publiée", "{n} publiées")}
        </span>
        <Button variant="outline" size="sm" onClick={() => setMonth(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>{t("Aujourd'hui")}</Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("Mois précédent")} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("Mois suivant")} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight /></Button>
      </div>
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>
        {weekdays.map((w) => <span key={w} className="py-1.5 first-letter:uppercase">{w}</span>)}
      </div>
      {!data ? <Loading className="p-4" /> : (
        <div className="grid grid-cols-7" role="grid">
          {days.map((day, i) => {
            const d = byDate.get(day);
            const count = d ? Object.values(d.planned).reduce((a, b) => a + (b ?? 0), 0) : 0;
            const inMonth = day.startsWith(month);
            const isToday = day === today;
            const empty = !d || (count === 0 && d.published === 0 && d.failed === 0);
            return (
              <button
                key={day}
                type="button"
                role="gridcell"
                onClick={() => setOpen(day)}
                aria-label={`${dateFormat({ weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(at(day))}${count ? `, ${tn(count, "{n} prévue", "{n} prévues")}` : ""}${d?.published ? `, ${tn(d.published, "{n} publiée", "{n} publiées")}` : ""}${d?.failed ? `, ${tn(d.failed, "{n} en échec", "{n} en échec")}` : ""}`}
                data-testid={`calendar-day-${day}`}
                className={cn(
                  "grid min-h-16 content-start gap-1 border-b p-1 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent sm:min-h-24 sm:p-1.5",
                  i % 7 !== 6 && "border-r",
                  !inMonth && "bg-muted/30 text-muted-foreground/70",
                )}
              >
                <span className={cn("tabular flex size-6 items-center justify-center rounded-full text-xs", isToday && "bg-foreground font-semibold text-background")}>{Number(day.slice(8))}</span>
                {!empty && (
                  <span className="grid gap-0.5">
                    {count > 0 && (
                      <span className="tabular flex items-center gap-1 rounded bg-brand-soft px-1 text-[11px] font-medium text-primary">
                        <CalendarClock className="size-3 shrink-0 max-sm:hidden" aria-hidden />{count}
                        <span className="truncate max-sm:hidden">{Object.keys(d!.planned).length > 1 ? "" : ` · ${label(Object.keys(d!.planned)[0]!)}`}</span>
                      </span>
                    )}
                    {d!.published > 0 && (
                      <span className="tabular flex items-center gap-1 rounded bg-success-soft px-1 text-[11px] font-medium text-success"><CircleCheck className="size-3 shrink-0" aria-hidden />{d!.published}</span>
                    )}
                    {d!.failed > 0 && (
                      <span className="tabular flex items-center gap-1 rounded bg-destructive-soft px-1 text-[11px] font-medium text-destructive"><CircleAlert className="size-3 shrink-0" aria-hidden />{d!.failed}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[11px] text-muted-foreground sm:px-4">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-brand-soft ring-1 ring-primary/40" aria-hidden />{t("Prévues")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-success" aria-hidden />{t("Publiées")}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-destructive" aria-hidden />{t("En échec")}</span>
      </div>
      {open && (
        <DayDetail date={open} today={today} channelLabel={label} onClose={() => setOpen(null)}
          onChanged={() => { setVersion((v) => v + 1); onChanged(); }} />
      )}
    </section>
  );
}

function DayDetail({ date, today, channelLabel, onClose, onChanged }: {
  date: string; today: string; channelLabel: (id: string) => string; onClose: () => void; onChanged: () => void;
}) {
  const [data, setData] = useState<PublicationDay | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; to: string } | null>(null);
  const load = () => api.publicationDay(date).then(setData).catch((e: Error) => toast.error(e.message));
  useEffect(() => {
    void load();
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      setMoving(null);
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const title = dateFormat({ weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(at(date));
  const due = (data?.entries ?? []).filter((e) => e.status === "PENDING").length;
  return (
    <Modal title={title.charAt(0).toUpperCase() + title.slice(1)} onClose={onClose}>
      <div className="grid gap-3" data-testid="calendar-day">
        {!data ? <Loading /> : data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{date < today ? t("Aucune mise en ligne ce jour-là.") : t("Rien de prévu ce jour-là. Planifie des cartes depuis le stock ou avec « Planifier ».")}</p>
        ) : (
          <>
            {date <= today && due > 0 && (
              <Button size="sm" className="justify-self-start" disabled={busy !== null} onClick={() => run("run", () => api.runPublications(), t("Mises en ligne du jour lancées"))}>
                {busy === "run" ? <Spinner /> : <Send />} {t("Publier maintenant les {n} du jour", { n: formatNumber(due) })}
              </Button>
            )}
            <ul className="grid divide-y">
              {data.entries.map((e, i) => {
                const status = STATUS[e.status];
                const key = e.id ?? `${e.offerId}-${i}`;
                return (
                  <li key={key} className="grid gap-2 py-2.5" data-testid="calendar-entry">
                    <div className="flex items-start gap-3">
                      {e.photoUrl
                        ? <img src={e.photoUrl} alt="" loading="lazy" className="aspect-[63/88] w-9 shrink-0 rounded-[3px] bg-muted object-cover ring-1 ring-border" />
                        : <span className="aspect-[63/88] w-9 shrink-0 rounded-[3px] bg-muted ring-1 ring-border" aria-hidden />}
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <Link href={`/stock?offer=${e.offerId}`} className="truncate text-sm font-medium underline-offset-2 hover:underline">{e.cardName}</Link>
                        <span className="truncate text-xs text-muted-foreground"><Code>{e.setCode}</Code> · {e.condition} · {channelLabel(e.channel)}{e.priceCents !== null && ` · ${formatEuros(e.priceCents)}`}</span>
                        {e.status === "FAILED" && <span className="text-xs text-destructive">{t(PLAN_ERRORS[e.errorCode ?? ""] ?? "erreur du canal")}</span>}
                      </span>
                      <Badge variant={status.variant}>{t(status.label)}</Badge>
                    </div>
                    {e.id && (e.status === "PENDING" || e.status === "FAILED") && (
                      moving?.id === e.id ? (
                        <form className="flex flex-wrap items-center gap-2" onSubmit={(ev) => { ev.preventDefault(); void run(e.id!, () => api.reschedulePublication(e.id!, moving.to), e.status === "FAILED" ? t("Mise en ligne replanifiée") : t("Mise en ligne déplacée")); }}>
                          <Input type="date" min={today} value={moving.to} onChange={(ev) => setMoving({ id: e.id!, to: ev.target.value })} className="h-9 w-auto md:h-9" aria-label={t("Nouvelle date")} required />
                          <Button type="submit" size="sm" disabled={busy !== null || !moving.to}>{busy === e.id ? <Spinner /> : null} {t("Valider")}</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setMoving(null)}>{t("Annuler")}</Button>
                        </form>
                      ) : (
                        <div className="flex flex-wrap gap-2 pl-12">
                          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setMoving({ id: e.id!, to: e.status === "FAILED" ? today : addDays(date < today ? today : date, 1) })}>
                            <CalendarClock /> {e.status === "FAILED" ? t("Replanifier") : t("Déplacer")}
                          </Button>
                          {e.status === "PENDING" && (
                            <Button size="sm" variant="ghost" disabled={busy !== null}
                              onClick={() => run(e.id!, () => api.cancelPublications({ offerId: e.offerId, channel: e.channel }), t("Mise en ligne annulée"))}>
                              <X /> {t("Annuler")}
                            </Button>
                          )}
                        </div>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
