"use client";

import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Bot, ClipboardPen, History, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Code, EmptyState, Loading, Spinner } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useCachedState } from "@/lib/cache";
import { dateFormat, formatNumber, movementLabel } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { MovementCategory, MovementKind, MovementPage, StockMovement } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<MovementKind, LucideIcon> = { IN: ArrowDownToLine, OUT: ArrowUpFromLine, ADJUST: ClipboardPen, MOVE: ArrowLeftRight };
const KINDS: { value: MovementKind | ""; label: string }[] = [
  { value: "", label: "Tous les mouvements" },
  { value: "IN", label: "Entrées" },
  { value: "OUT", label: "Sorties" },
  { value: "ADJUST", label: "Corrections" },
  { value: "MOVE", label: "Déplacements" },
];
const SUPPLY_LABEL: Record<string, string> = { RECEIVE: "Réception", CONSUME: "Envoi", ADJUST: "Inventaire" };

function label(m: StockMovement): string {
  if (m.category === "SUPPLY") return m.reason === "initial" ? t("Stock initial") : t(SUPPLY_LABEL[m.type] ?? m.type);
  return movementLabel({ movementType: m.type as never });
}

/** « agent:Airth » → « Airth », marqué comme agent ; le propriétaire n'est pas nommé. */
function Actor({ actor }: { actor: string }) {
  if (actor.startsWith("agent:")) {
    return <span className="inline-flex items-center gap-1"><Bot className="size-3" aria-hidden />{actor.slice(6)}</span>;
  }
  return null;
}

const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(iso));
function dayTitle(iso: string): string {
  const key = dayKey(iso);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return t("Aujourd'hui");
  if (key === yesterday) return t("Hier");
  const text = dateFormat({ weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
const time = () => dateFormat({ hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function Delta({ m }: { m: StockMovement }) {
  if (m.kind === "MOVE") return <Code className="text-xs text-muted-foreground">→ {m.toLocation}</Code>;
  const n = m.qtyDelta;
  return (
    <span className={cn("tabular text-sm font-semibold", n > 0 ? "text-success" : n < 0 && m.kind === "ADJUST" ? "text-destructive" : "text-foreground")}>
      {n > 0 ? "+" : n < 0 ? "−" : "±"}{formatNumber(Math.abs(n))}
    </span>
  );
}

function MovementRow({ m, compact }: { m: StockMovement; compact?: boolean }) {
  const Icon = KIND_ICON[m.kind];
  const link: { href: string; text: string } | null = m.orderId ? { href: `/sales/${m.orderId}`, text: t("Voir la vente") }
    : m.unitSku && !compact ? { href: `/inventory/${m.unitSku}`, text: m.unitSku }
    : m.supplyId && !compact ? { href: `/stock?section=supplies&item=${m.supplyId}`, text: t("Voir la fourniture") }
    : null;
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid="stock-movement">
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
        m.kind === "IN" ? "bg-success-soft text-success" : m.kind === "OUT" ? "bg-muted text-foreground/70" : m.kind === "ADJUST" ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground")} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">
            {!compact && <strong className="font-medium">{m.name}</strong>}
            {!compact && " · "}
            <span className={compact ? "font-medium" : "text-muted-foreground"}>{label(m)}</span>
          </span>
          <Delta m={m} />
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="tabular">{compact ? dateFormat({ day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date(m.at)) : time().format(new Date(m.at))}</span>
          {!compact && m.detail && <><span aria-hidden>·</span><span className="truncate">{m.detail}</span></>}
          {m.kind === "MOVE" && m.fromLocation && <><span aria-hidden>·</span><Code>{m.fromLocation} → {m.toLocation}</Code></>}
          {m.actor.startsWith("agent:") && <><span aria-hidden>·</span><Actor actor={m.actor} /></>}
          {m.reason && m.reason !== "initial" && <><span aria-hidden>·</span><span className="[overflow-wrap:anywhere]">{m.reason}</span></>}
          {link && <><span aria-hidden>·</span><Link href={link.href} className="font-medium text-foreground/80 underline-offset-2 hover:underline">{link.text}</Link></>}
        </span>
      </span>
    </li>
  );
}

/** Derniers mouvements d'un article (carte ou fourniture), dans sa fiche. */
export function RecentMovements({ offerId, supplyId, version }: { offerId?: string; supplyId?: string; version?: number }) {
  const key = `movements:${offerId ?? supplyId}`;
  const [data, setData] = useCachedState<MovementPage>(key);
  useEffect(() => {
    api.stockMovements({ offerId, supplyId, limit: 6, days: 30 }).then(setData).catch(() => undefined);
  }, [offerId, supplyId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Loading />;
  if (data.movements.length === 0) return <p className="text-[13px] text-muted-foreground">{t("Aucun mouvement pour l'instant.")}</p>;
  const href = offerId ? "/stock?section=movements" : "/stock?section=movements&category=SUPPLY";
  return (
    <div className="grid gap-1">
      <ul className="divide-y" data-testid="recent-movements">{data.movements.map((m) => <MovementRow key={m.id} m={m} compact />)}</ul>
      <Link href={href} className="justify-self-start text-[13px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">{t("Tout le journal")}</Link>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "warning" }) {
  return (
    <div className="grid gap-1 bg-card p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("tabular text-lg leading-none font-semibold tracking-tight", tone === "success" && "text-success", tone === "warning" && "text-warning")}>{value}</span>
    </div>
  );
}

/** Le journal du stock : tout ce qui est entré, sorti, a été corrigé ou déplacé, cartes et fournitures, jour par jour. */
export function MovementsView({ initialCategory }: { initialCategory?: MovementCategory }) {
  const [category, setCategory] = useState<MovementCategory | "ALL">(initialCategory ?? "ALL");
  const [kind, setKind] = useState<MovementKind | "">("");
  const [data, setData] = useCachedState<MovementPage>(`movements:${category}:${kind}`, { keepPrevious: true });
  const [more, setMore] = useState<MovementPage["movements"]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = { category: category === "ALL" ? undefined : category, kind: kind || undefined };
  useEffect(() => {
    setMore([]);
    api.stockMovements({ ...query, limit: 50 }).then((page) => { setData(page); setNext(page.next); }).catch((e: Error) => setError(e.message));
  }, [category, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!next) return;
    setLoading(true);
    try {
      const page = await api.stockMovements({ ...query, limit: 50, before: next });
      setMore((m) => [...m, ...page.movements]);
      setNext(page.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const movements = data ? [...data.movements, ...more] : [];
  const days: { key: string; title: string; items: StockMovement[] }[] = [];
  for (const m of movements) {
    const key = dayKey(m.at);
    if (days.at(-1)?.key !== key) days.push({ key, title: dayTitle(m.at), items: [] });
    days.at(-1)!.items.push(m);
  }
  const s = data?.summary;

  return (
    <div className="grid gap-4" data-testid="stock-journal">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs label={t("Rubrique")} value={category} onChange={setCategory}
          tabs={[{ value: "ALL", label: t("Tout") }, { value: "CARD", label: t("Cartes") }, { value: "SUPPLY", label: t("Fournitures") }]} />
        <Select value={kind} onChange={(e) => setKind(e.target.value as MovementKind | "")} aria-label={t("Type de mouvement")} className="h-9 w-auto text-sm md:h-9">
          {KINDS.map((k) => <option key={k.value} value={k.value}>{t(k.label)}</option>)}
        </Select>
      </div>
      {s && (
        <section aria-label={t("Sur {n} jours", { n: s.days })} className="grid gap-1.5">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">{t("Sur {n} jours", { n: s.days })}</h2>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4" data-testid="journal-summary">
            <Figure label={t("Entrées")} value={s.in > 0 ? `+${formatNumber(s.in)}` : "0"} tone={s.in > 0 ? "success" : undefined} />
            <Figure label={t("Sorties")} value={s.out > 0 ? `−${formatNumber(s.out)}` : "0"} />
            <Figure label={t("Corrections")} value={s.adjusted === 0 ? "0" : `${s.adjusted > 0 ? "+" : "−"}${formatNumber(Math.abs(s.adjusted))}`} tone={s.adjusted !== 0 ? "warning" : undefined} />
            <Figure label={t("Déplacements")} value={formatNumber(s.moves)} />
          </div>
        </section>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {!data && !error && <Loading />}
      {data && movements.length === 0 && (
        <EmptyState icon={<History />} title={t("Aucun mouvement")}>{t("Les entrées, ventes expédiées, corrections et déplacements apparaîtront ici.")}</EmptyState>
      )}
      {days.map((d) => (
        <section key={d.key} className="grid gap-1" aria-label={d.title}>
          <h2 className="px-1 text-xs font-medium text-muted-foreground">{d.title}</h2>
          <ul className="divide-y rounded-lg border bg-card px-3">{d.items.map((m) => <MovementRow key={m.id} m={m} />)}</ul>
        </section>
      ))}
      {next && (
        <Button variant="outline" className="justify-self-center" onClick={loadMore} disabled={loading}>{loading ? <Spinner /> : null} {t("Mouvements plus anciens")}</Button>
      )}
    </div>
  );
}
