"use client";

import { BookOpen, Check, CircleSlash, PackageCheck, Pencil, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BackLink, Code, EmptyState, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { Pagination, paginate } from "@/components/ui/tabs";
import { type ApiError, api } from "@/lib/api";
import { catalogMessage, fold, importedLabel } from "@/lib/catalog";
import { useCardImage } from "@/lib/card-image";
import { dateFormat, formatDateTime, formatEuros, variantLabel } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { CONFIDENCE_LABEL } from "@/lib/pricing";
import type { CatalogSetCard, CatalogSetDetail } from "@/lib/types";
import { PageSkeleton } from "@/components/skeletons";

const PAGE_SIZE = 24;

function CardTile({ card }: { card: CatalogSetCard }) {
  const { src, onError } = useCardImage(card.imageUrl);
  return (
    <Card className="flex flex-col overflow-hidden" data-testid={`card-${card.localNumber}`}>
      <div className="relative bg-muted">
        {src
          ? <img src={src} alt="" loading="lazy" onError={onError} className="aspect-[63/88] w-full object-cover" />
          : <div className="flex aspect-[63/88] w-full items-center justify-center text-muted-foreground/40" aria-hidden><BookOpen className="size-8" /></div>}
        {card.owned > 0 && (
          <Badge variant="success" className="absolute top-2 right-2 shadow-sm"><PackageCheck /> {t("{n} en stock", { n: card.owned })}</Badge>
        )}
      </div>
      <div className="grid gap-2 p-3">
        <div className="grid gap-0.5">
          <Link href={`/card/${card.id}`} className="truncate text-sm font-semibold underline-offset-2 outline-none hover:underline focus-visible:underline" title={card.name}>{card.name}</Link>
          <p className="truncate text-xs text-muted-foreground"><Code>{t("n° {number}", { number: card.localNumber })}</Code>{card.rarity ? ` · ${card.rarity}` : ""}</p>
        </div>
        <ul className="grid gap-1 border-t pt-2 text-xs">
          {card.variants.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-muted-foreground">{variantLabel(v)}{v.incomplete ? ` ${t("(à confirmer)")}` : ""}</span>
              <span
                className={v.estimate && !v.estimate.sales ? "tabular shrink-0 text-muted-foreground" : "tabular shrink-0 font-medium"}
                title={v.estimate ? `${v.estimate.sales ? t("Ventes réussies Cardmarket ({confidence})", { confidence: t(CONFIDENCE_LABEL[v.estimate.sales.confidence]) }) : t("Aucune vente récente : tendance des annonces Cardmarket")}, ${t("relevé du {date}", { date: formatDateTime(v.estimate.observedAt) })}${v.estimate.variantAmbiguous ? ` — ${t("partagé avec une autre variante")}` : ""}` : undefined}
              >
                {v.estimate === null ? "—" : `${v.estimate.variantAmbiguous || !v.estimate.sales ? "≈ " : ""}${formatEuros(v.estimate.cents)}`}
              </span>
            </li>
          ))}
          {card.variants.length === 0 && <li className="text-muted-foreground">{t("Aucune variante connue")}</li>}
        </ul>
      </div>
    </Card>
  );
}

export default function CatalogSetPage() {
  const { id } = useParams<{ id: string }>();
  const setId = decodeURIComponent(id);
  const [language, setLanguage] = useState<string | null>(null);
  const [detail, setDetail] = useState<CatalogSetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [filter, setFilter] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);

  async function saveCode(code: string | null) {
    if (!detail || !language) return;
    try {
      const saved = await api.setSetCode(detail.set.id, language, code);
      setDetail({ ...detail, set: { ...detail.set, ...saved } });
      setCodeDraft(null);
      toast.success(t("Code d'extension enregistré"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  useEffect(() => {
    setLanguage(new URLSearchParams(window.location.search).get("language") ?? "fr");
  }, []);

  const load = useCallback(() => {
    if (!language) return;
    api.catalogSet(setId, language)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e: ApiError) => (e.status === 404 ? setNotFound(true) : setError(catalogMessage(e))));
  }, [setId, language]);
  useEffect(load, [load]);

  async function sync() {
    if (!language) return;
    setSyncing(true);
    try {
      const report = await api.syncCatalogSet(setId, language);
      toast[report.errorCount ? "warning" : "success"](
        report.errorCount ? t("{imported}, {n} en échec", { imported: importedLabel(report.cards), n: report.errorCount }) : t("{imported}, cotations à jour", { imported: importedLabel(report.cards) }),
      );
      load();
    } catch (e) {
      toast.error(catalogMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  const wanted = fold(filter.trim());
  const matching = useMemo(
    () => (detail?.cards ?? []).filter((c) => (!ownedOnly || c.owned > 0) && (!wanted || fold(c.name).includes(wanted) || c.localNumber.toLowerCase().includes(wanted))),
    [detail, wanted, ownedOnly],
  );
  const view = paginate(matching, page, PAGE_SIZE);

  const back = <BackLink href="/catalog">{t("Catalogue")}</BackLink>;

  if (notFound) {
    return (
      <div className="grid gap-5">
        {back}
        <EmptyState icon={<CircleSlash />} title={t("Série inconnue")}>{t("Aucune série")} <Code>{setId}</Code> {t("pour cette langue. Actualisez la liste depuis le catalogue.")}</EmptyState>
      </div>
    );
  }
  if (!detail) return error ? <Alert variant="destructive">{error}</Alert> : <PageSkeleton label={t("Chargement de la série")} />;

  const { set, cards } = detail;
  const total = set.cardCountTotal ?? set.cardCountOfficial;
  const ownedCards = cards.filter((c) => c.owned > 0).length;
  const ownedCopies = cards.reduce((n, c) => n + c.owned, 0);

  return (
    <div className="grid gap-5">
      {back}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">{set.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            {codeDraft === null ? (
              <button type="button" onClick={() => setCodeDraft(set.codeOverride ?? set.code)} data-testid="set-code"
                title={t("Code d'extension utilisé dans le stock et la recherche ; cliquez pour le corriger")}
                className="inline-flex h-6 items-center gap-1 rounded-md border bg-card px-2 font-mono text-xs font-semibold text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30">
                {set.code} <Pencil className="size-3 text-muted-foreground" aria-hidden />
              </button>
            ) : (
              <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); void saveCode(codeDraft.trim() || null); }}>
                <Input autoFocus value={codeDraft} onChange={(e) => setCodeDraft(e.target.value)} maxLength={20} aria-label={t("Code d'extension")} className="h-7 w-28 font-mono text-xs uppercase md:h-7" data-testid="set-code-input" />
                <Button type="submit" size="icon-sm" variant="outline" aria-label={t("Enregistrer le code")}><Check /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={t("Annuler")} onClick={() => setCodeDraft(null)}><X /></Button>
                {set.codeOverride && <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => void saveCode(null)}>{t("Code déduit")}</Button>}
              </form>
            )}
            <Badge variant="neutral"><Code>{set.id}</Code></Badge>
            {set.serieName && <Badge variant="outline">{set.serieName}</Badge>}
            {(set.abbreviationLocalized ?? set.abbreviation) && <Badge variant="outline">{t("Code imprimé {code}", { code: (set.abbreviationLocalized ?? set.abbreviation)! })}</Badge>}
            {set.releaseDate && <span>{t("Sortie le {date}", { date: dateFormat({}).format(new Date(`${set.releaseDate}T12:00:00Z`)) })}</span>}
          </div>
        </div>
        <Button variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? <><Spinner /> {t("Import…")}</> : <><RefreshCw /> {t("Mettre à jour")}</>}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          {[
            [t("Cartes importées"), total ? `${set.cardsSynced} / ${total}` : String(set.cardsSynced)],
            [t("Cartes possédées"), `${ownedCards}`],
            [t("Exemplaires en stock"), `${ownedCopies}`],
            [t("Dernier import"), set.cardsSyncedAt ? formatDateTime(set.cardsSyncedAt) : t("jamais")],
          ].map(([label, value]) => (
            <div key={label} className="grid gap-1.5 bg-card px-4 py-3.5">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="tabular text-lg leading-none font-semibold tracking-tight">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {cards.length === 0 ? (
        <EmptyState icon={<BookOpen />} title={t("Série non importée")} action={<Button size="sm" onClick={sync} disabled={syncing}>{t("Importer la série")}</Button>}>
          {t("Les cartes de cette série ne sont pas encore dans le catalogue.")}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="relative block min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                placeholder={t("Nom ou numéro de carte")}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
                aria-label={t("Filtrer les cartes")}
                autoCorrect="off"
                className="pl-9"
              />
            </span>
            <SwitchRow label={t("En stock seulement")} checked={ownedOnly} onCheckedChange={(v) => { setOwnedOnly(v); setPage(1); }} />
          </div>
          <p className="tabular text-sm text-muted-foreground" role="status">
            {tn(matching.length, "{n} carte", "{n} cartes")}. {t("Prix estimés d'après les ventes réussies sur Cardmarket, toutes langues et tous états confondus ; « ≈ » quand rien ne s'est vendu récemment.")}
          </p>

          {view.items.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {view.items.map((c) => <CardTile key={c.id} card={c} />)}
            </div>
          ) : (
            <EmptyState icon={<Search />} title={t("Aucune carte ne correspond")} />
          )}
          <Pagination page={view.page} pageCount={view.pageCount} onChange={(p) => { setPage(p); window.scrollTo({ top: 0 }); }} />
        </>
      )}
    </div>
  );
}
