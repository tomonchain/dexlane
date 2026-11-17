"use client";

import { ArrowRight, Camera, Check, ChevronRight, Copy, Layers, RotateCcw, ScanLine, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CandidateList, CardThumb, ManualSearch } from "@/components/card-chooser";
import { LocationField } from "@/components/location-picker";
import { Stepper } from "@/components/stepper";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, PageHeader, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { ApiError, api, createKeyring } from "@/lib/api";
import { parseEuros, reviewReason, variantLabel } from "@/lib/format";
import { prepareImage } from "@/lib/image";
import { useStored } from "@/lib/storage";
import { CONDITIONS, type AcquisitionLot, type Candidate, type CardCondition, type PositionDetail, type Received, type ScanResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Réglages qui restent d'une carte à l'autre : on range une série de cartes au même endroit, au même coût. */
interface Session {
  locationCode: string;
  cost: string;
  lotId: string;
  language: string;
}
const DEFAULT_SESSION: Session = { locationCode: "", cost: "0", lotId: "", language: "fr" };
const LANGUAGES: [string, string][] = [
  ["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["it", "Italien"], ["es", "Espagnol"], ["pt", "Portugais"], ["ja", "Japonais"],
];

const SCAN_ERRORS: Record<string, string> = {
  SCAN_UNAVAILABLE: "La lecture automatique est indisponible. Recherchez la carte à la main.",
  REFUSED: "Le modèle n'a pas pu lire cette photo. Recherchez la carte à la main ou reprenez la photo.",
  TRUNCATED: "La lecture a été interrompue. Reprenez la photo ou recherchez la carte à la main.",
  UNPARSEABLE: "La lecture n'a pas abouti. Reprenez la photo ou recherchez la carte à la main.",
  IMAGE_TOO_LARGE: "Photo trop lourde. Reprenez-la d'un peu plus loin.",
  UNSUPPORTED_MEDIA_TYPE: "Format d'image non pris en charge. Prenez la photo en JPEG.",
};
const SUBMIT_ERRORS: Record<string, string> = {
  LOCATION_NOT_FOUND: "Cet emplacement n'existe pas. Choisissez-en un autre.",
  ACQUISITION_LOT_NOT_FOUND: "Ce lot d'acquisition n'existe plus. Choisissez-en un autre.",
  INSUFFICIENT_STOCK: "Le lot de vrac ne contient plus assez de cartes.",
  NOT_BULK: "Cette position n'est pas un lot de vrac.",
  VARIANT_NOT_FOUND: "Cette variante n'existe plus dans le catalogue. Relancez la recherche.",
  NETWORK: "Connexion impossible. Réessayez : la même saisie ne sera pas enregistrée deux fois.",
};

type Phase = "idle" | "reading" | "form" | "done";
interface Entry {
  received: Received;
  name: string;
}

export default function ScannerPage() {
  return (
    <Suspense>
      <Scanner />
    </Suspense>
  );
}

/** Étape numérotée du formulaire ; la pastille se coche quand l'étape est renseignée. */
function Step({ n, title, done, aside, children }: { n: number; title: string; done: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "tabular flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              done ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
          </span>
          <h2 className="flex-1 text-[15px] font-semibold tracking-tight">{title}</h2>
          {aside}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Scanner() {
  const bulkId = useSearchParams().get("vrac");
  const [session, setSession, sessionReady] = useStored<Session>("dexlane.scan.session", DEFAULT_SESSION);
  const [phase, setPhase] = useState<Phase>("idle");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [manual, setManual] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [condition, setCondition] = useState<CardCondition | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [unique, setUnique] = useState(false);
  const [draft, setDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Entry | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [bulk, setBulk] = useState<PositionDetail | null>(null);
  const [lots, setLots] = useState<AcquisitionLot[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const keyring = useRef(createKeyring());

  useEffect(() => {
    if (bulkId) api.position(bulkId).then(setBulk).catch((e: Error) => setError(e.message));
    else api.lots().then((r) => setLots(r.lots)).catch(() => setLots([]));
  }, [bulkId]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  // Accolades obligatoires : scrollTo peut renvoyer une promesse, que React prendrait pour une fonction de nettoyage.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  const card = candidates.find((c) => c.catalogCardId === cardId) ?? null;
  const variant = card?.variants.find((v) => v.id === variantId) ?? null;
  const costCents = parseEuros(session.cost);
  const missing = [
    !card && "la carte",
    card && !variant && "la variante",
    !condition && "l'état",
    !session.locationCode && "l'emplacement",
    !bulkId && costCents === null && "un coût valide",
  ].filter(Boolean) as string[];

  function resetCard() {
    setScan(null);
    setScanError(null);
    setCandidates([]);
    setManual(false);
    setCardId(null);
    setVariantId(null);
    setCondition(null);
    setQuantity(1);
    setUnique(false);
    setDraft(false);
    setError(null);
    keyring.current.reset();
  }

  function selectCard(c: Candidate, suggestedVariantId: string | null = null) {
    setCardId(c.catalogCardId);
    setVariantId(
      suggestedVariantId && c.variants.some((v) => v.id === suggestedVariantId) ? suggestedVariantId
      : c.variants.length === 1 ? c.variants[0]!.id
      : null,
    );
  }

  async function onPhoto(file: File) {
    resetCard();
    setPhotoUrl(URL.createObjectURL(file));
    setPhase("reading");
    try {
      const result = await api.scan(await prepareImage(file), session.language);
      setScan(result);
      setCandidates(result.candidates);
      // Présélection uniquement quand l'identification est sûre ; sinon l'opérateur choisit explicitement.
      if (!result.requiresReview && result.candidates[0]) selectCard(result.candidates[0], result.suggestedVariantId);
      if (result.candidates.length === 0) setManual(true);
    } catch (e) {
      setScanError(e instanceof ApiError ? (SCAN_ERRORS[e.code] ?? e.message) : (e as Error).message);
      setManual(true);
    }
    setPhase("form");
  }

  function startManual() {
    resetCard();
    setPhotoUrl(null);
    setManual(true);
    setPhase("form");
  }

  async function submit() {
    if (!card || !variant || !condition || missing.length) return;
    setSubmitting(true);
    setError(null);
    const base = {
      variantId: variant.id,
      condition,
      quantity: unique ? 1 : quantity,
      locationCode: session.locationCode,
      unique: unique || undefined,
      draft: draft || undefined,
    };
    try {
      const received = bulkId
        ? await api.extract(bulkId, base, keyring.current.keyFor({ bulkId, base }))
        : await (async () => {
            const payload = { ...base, unitCostCents: costCents!, acquisitionLotId: session.lotId || undefined };
            return api.receive(payload, keyring.current.keyFor(payload));
          })();
      const entry = { received, name: card.name };
      setLast(entry);
      setHistory((h) => [entry, ...h]);
      setPhase("done");
      if (bulkId) api.position(bulkId).then(setBulk).catch(() => undefined);
    } catch (e) {
      setError(e instanceof ApiError ? (SUBMIT_ERRORS[e.code] ?? e.message) : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      data-testid="photo-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void onPhoto(file);
      }}
    />
  );

  const storageFields = (
    <div className="grid gap-3">
      <LocationField value={session.locationCode} onChange={(code) => setSession({ ...session, locationCode: code })} />
      {!bulkId && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Coût unitaire (€)">
            <Input
              inputMode="decimal"
              value={session.cost}
              onChange={(e) => setSession({ ...session, cost: e.target.value })}
              onFocus={(e) => e.target.select()}
              aria-invalid={costCents === null}
              className="tabular"
            />
          </Field>
          <Field label="Lot d'acquisition">
            <Select value={session.lotId} onChange={(e) => setSession({ ...session, lotId: e.target.value })}>
              <option value="">Aucun</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>{l.purchaseDate} · {l.sourceType}{l.sellerRef ? ` · ${l.sellerRef}` : ""}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </div>
  );

  const bulkBanner = bulkId && (
    <Alert variant="info">
      <strong>Extraction du vrac</strong>{bulk ? ` — ${bulk.bulk?.label ?? bulk.unitSku} (${bulk.availableToSell} cartes disponibles)` : ""}.{" "}
      <Link href={`/inventaire/${bulk?.unitSku ?? bulkId}`} className="font-medium underline underline-offset-2">Retour au lot</Link>
    </Alert>
  );

  // ───────────────────────── Accueil du scanner et résultat ─────────────────────────

  if (phase === "idle" || phase === "done") {
    const sessionCards = history.reduce((n, e) => n + e.received.stockItem.onHand, 0);
    return (
      <div className="mx-auto grid max-w-2xl gap-5">
        {fileInput}
        <PageHeader
          title={bulkId ? "Extraire une carte" : "Scanner"}
          description={bulkId ? "Identifiez la carte sortie du lot, puis rangez-la." : "Photographiez une carte : elle est identifiée, vous confirmez, elle entre en stock."}
        />
        {bulkBanner}
        {error && phase === "idle" && <Alert variant="destructive">{error}</Alert>}

        {phase === "done" && last && (
          <Card className="overflow-hidden border-success/25" aria-live="polite">
            <div className="flex items-center gap-2 border-b border-success/15 bg-success-soft px-4 py-2.5 text-sm font-medium text-success sm:px-5">
              <Check className="size-4" strokeWidth={2.5} aria-hidden /> Entrée en stock enregistrée.
            </div>
            <CardContent className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <div className="grid gap-1">
                  <Eyebrow>Code de la position</Eyebrow>
                  <p className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="unit-sku">{last.received.stockItem.unitSku}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard?.writeText(last.received.stockItem.unitSku).then(() => toast.success("Code copié"))}
                >
                  <Copy /> Copier
                </Button>
              </div>
              <p className="text-sm">
                <strong className="font-semibold">{last.name}</strong> × {last.received.stockItem.onHand}, rangé en{" "}
                <Code>{last.received.locationCode}</Code>
              </p>
              <p className="text-sm text-muted-foreground">
                Notez ce code sur la pochette. Offre <Code>{last.received.offer.offerSku}</Code>{" "}
                ({last.received.offer.created ? "nouvelle" : "existante, position ajoutée"}).
              </p>
              {last.received.stockItem.lifecycle === "DRAFT" && (
                <Alert variant="warning">Brouillon : non vendable tant qu'il n'est pas validé depuis sa fiche.</Alert>
              )}
              {last.received.variantIncomplete && (
                <Alert variant="warning">Variante incomplète dans le catalogue : à confirmer avant toute publication.</Alert>
              )}
              <Button variant="link" size="sm" asChild className="justify-self-start">
                <Link href={`/inventaire/${last.received.stockItem.unitSku}`}>Voir la fiche <ArrowRight /></Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-dashed bg-gradient-to-b from-brand-soft/60 to-card">
          <CardContent className="grid gap-3 py-6 sm:py-8">
            {phase === "idle" && (
              <div className="mx-auto mb-1 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden>
                <ScanLine className="size-7" />
              </div>
            )}
            <Button size="xl" onClick={() => fileRef.current?.click()} disabled={!sessionReady} className="w-full">
              <Camera /> {phase === "done" ? "Photographier la suivante" : "Photographier une carte"}
            </Button>
            <Button variant="outline" size="lg" onClick={startManual} className="w-full">
              <Search /> Rechercher sans photo
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-[15px] font-semibold tracking-tight">Réglages de la session</h2>
              <p className="text-sm text-muted-foreground">Conservés d'une carte à l'autre.</p>
            </div>
            {storageFields}
            <Field label="Langue par défaut des cartes">
              <Select value={session.language} onChange={(e) => setSession({ ...session, language: e.target.value })}>
                {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </Select>
            </Field>
          </CardContent>
        </Card>

        {history.length > 0 && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between px-1">
              <Eyebrow>Cette session</Eyebrow>
              <span className="tabular text-xs text-muted-foreground">{sessionCards} carte{sessionCards > 1 ? "s" : ""}</span>
            </div>
            <Card className="divide-y overflow-hidden">
              {history.map((e) => (
                <Link key={e.received.stockItem.id} href={`/inventaire/${e.received.stockItem.unitSku}`} className="flex items-center gap-3 px-4 py-3 text-sm outline-none hover:bg-accent focus-visible:bg-accent">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="flex gap-2 text-xs text-muted-foreground"><Code>{e.received.stockItem.unitSku}</Code><Code>{e.received.locationCode}</Code></span>
                  </span>
                  <span className="tabular font-semibold">× {e.received.stockItem.onHand}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </Card>
          </section>
        )}
      </div>
    );
  }

  // ───────────────────────── Lecture en cours ─────────────────────────

  if (phase === "reading") {
    return (
      <div className="mx-auto grid max-w-md gap-5">
        <PageHeader title="Lecture de la carte" />
        <Card className="overflow-hidden">
          {photoUrl && (
            <div className="relative bg-muted">
              <img className="mx-auto max-h-[52dvh] w-full object-contain" src={photoUrl} alt="Photo prise" />
              <div className="absolute inset-x-0 top-0 h-full animate-pulse bg-gradient-to-b from-primary/20 via-transparent to-transparent" aria-hidden />
            </div>
          )}
          <CardContent className="flex items-center gap-3" role="status">
            <Spinner className="size-5 text-primary" />
            <div className="grid">
              <span className="text-sm font-medium">Lecture du nom et du numéro…</span>
              <span className="text-xs text-muted-foreground">Rapprochement avec le catalogue</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ───────────────────────── Confirmation ─────────────────────────

  const reading = scan?.reading;
  const read = reading ? [reading.name, reading.collector_number, reading.set_code, scan?.language.toUpperCase()].filter(Boolean).join(" · ") : "";
  const conditionLabel = CONDITIONS.find((c) => c.code === condition)?.label;

  return (
    <div className="grid gap-5 pb-24 lg:pb-0">
      {fileInput}
      <PageHeader
        title={bulkId ? "Extraire une carte" : "Confirmer la carte"}
        description="Vérifiez l'identification, puis précisez l'état et le rangement."
        actions={photoUrl && (
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><RotateCcw /> Reprendre la photo</Button>
        )}
      />
      {bulkBanner}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid gap-5">
          <Step n={1} title="Carte" done={!!card}>
            {(photoUrl || reading) && (
              <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-2.5">
                {photoUrl && <img className="aspect-[63/88] w-16 shrink-0 rounded-md object-cover ring-1 ring-border" src={photoUrl} alt="Photo prise" />}
                {reading && (
                  <div className="grid gap-1 py-0.5">
                    <Eyebrow>Lu sur la photo</Eyebrow>
                    <p className="text-sm font-medium">{read || "rien de lisible"}</p>
                  </div>
                )}
              </div>
            )}
            {scanError && <Alert variant="destructive">{scanError}</Alert>}
            {scan && !scan.requiresReview && (
              <Alert variant="success"><strong>Identification sûre.</strong> Vérifiez tout de même la variante.</Alert>
            )}
            {scan?.requiresReview && scan.candidates.length > 0 && (
              <Alert variant="warning">
                <strong>À vérifier : choisissez la bonne carte.</strong>
                <ul className="mt-1 list-disc pl-4">
                  {scan.ambiguous && <li>plusieurs cartes très proches</li>}
                  {scan.reviewReasons.map((r) => <li key={r}>{reviewReason(r)}</li>)}
                  {!scan.ambiguous && scan.reviewReasons.length === 0 && <li>correspondance incertaine</li>}
                </ul>
              </Alert>
            )}
            {scan && scan.candidates.length === 0 && !scanError && (
              <Alert variant="warning">
                Aucune carte du catalogue ne correspond à la lecture. Recherchez-la à la main, ou synchronisez sa série depuis{" "}
                <Link href="/catalogue" className="font-medium underline underline-offset-2">le catalogue</Link>.
              </Alert>
            )}

            {candidates.length > 0 && (
              <CandidateList
                candidates={candidates}
                selectedId={cardId}
                onSelect={(c) => selectCard(c, c.catalogCardId === scan?.candidates[0]?.catalogCardId ? scan.suggestedVariantId : null)}
              />
            )}

            {manual ? (
              <ManualSearch
                language={scan?.language ?? session.language}
                initial={{ name: reading?.name ?? undefined, number: reading?.collector_number ?? undefined }}
                onResults={(found) => {
                  setCandidates(found);
                  setCardId(null);
                  setVariantId(null);
                }}
              />
            ) : (
              <Button variant="link" size="sm" onClick={() => setManual(true)} className="justify-self-start">
                Aucune ne correspond : rechercher à la main
              </Button>
            )}
          </Step>

          <Step n={2} title="Variante" done={!!variant}>
            {card ? (
              <div className="flex items-start gap-4">
                <CardThumb imageUrl={card.imageUrl} size="lg" />
                <div className="grid flex-1 gap-2">
                  <ChoiceGroup value={variantId} onValueChange={setVariantId} aria-label="Variante">
                    {card.variants.map((v) => (
                      <Choice key={v.id} value={v.id}>
                        {variantLabel(v)}
                        {v.incomplete && <span className="text-xs font-normal opacity-75">à confirmer</span>}
                      </Choice>
                    ))}
                  </ChoiceGroup>
                  {card.variants.length === 0 && <Alert variant="warning">Aucune variante connue pour cette carte : resynchronisez la série.</Alert>}
                  <p className="text-xs text-muted-foreground">Normale, holo ou reverse : regardez où se trouve le brillant.</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Choisissez d'abord la carte.</p>
            )}
          </Step>
        </div>

        <div className="grid gap-5 lg:sticky lg:top-6">
          <Step n={3} title="État" done={!!condition} aside={conditionLabel && <Badge variant="brand">{conditionLabel}</Badge>}>
            <ChoiceGroup value={condition} onValueChange={setCondition} aria-label="État" className="grid grid-cols-7 gap-1.5">
              {CONDITIONS.map((c) => (
                <Choice key={c.code} value={c.code} aria-label={c.label} title={c.label} className="px-0 font-mono text-[13px]">
                  {c.code}
                </Choice>
              ))}
            </ChoiceGroup>
            <p className="text-xs text-muted-foreground">Évalué à la main, recto et verso. Jamais prérempli.</p>
          </Step>

          <Step n={4} title="Quantité" done>
            <div className="flex items-center justify-between gap-4">
              <Stepper value={unique ? 1 : quantity} onChange={setQuantity} label="Quantité" max={unique ? 1 : 10000} />
              <span className="text-xs text-muted-foreground">{unique ? "Un seul exemplaire" : "Exemplaires identiques"}</span>
            </div>
            <SwitchRow label="Exemplaire unique" description="Forte valeur, vendu avec ses propres photos." checked={unique} onCheckedChange={setUnique} />
          </Step>

          <Step n={5} title="Rangement" done={!!session.locationCode && (!!bulkId || costCents !== null)}>
            {storageFields}
            <SwitchRow label="Brouillon" description="À revoir plus tard, non vendable d'ici là." checked={draft} onCheckedChange={setDraft} />
          </Step>

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="fixed inset-x-0 bottom-nav z-20 px-3 lg:static lg:px-0">
            <div className="flex gap-2 rounded-2xl border bg-popover/95 p-2 shadow-xl shadow-black/10 backdrop-blur-md lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
              <Button variant="outline" size="lg" onClick={() => { resetCard(); setPhase("idle"); }} disabled={submitting}>Annuler</Button>
              <Button size="lg" onClick={submit} disabled={submitting || missing.length > 0} className="min-w-0 flex-1" data-testid="confirm">
                {submitting ? <><Spinner className="text-primary-foreground" /> Enregistrement…</>
                  : missing.length ? <span className="truncate">Reste : {missing.join(", ")}</span>
                  : bulkId ? <><Layers /> Extraire et ranger</>
                  : <><Check strokeWidth={2.5} /> Entrer en stock</>}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
