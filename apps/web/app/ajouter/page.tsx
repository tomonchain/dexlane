"use client";

import { ArrowRight, Camera, Check, ChevronRight, Copy, Crop, Images, Layers, RotateCcw, ScanLine, Search } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CandidateList, CardThumb, ManualSearch } from "@/components/card-chooser";
import { LocationField } from "@/components/location-picker";
import { PriceEstimate } from "@/components/price-estimate";
import { Stepper } from "@/components/stepper";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, PageHeader, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros, reviewReason, variantLabel } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { CATEGORY_LABEL, CATEGORY_VARIANT, reasonLabel } from "@/lib/pricing";
import { preloadOpenCv, scanCardPhoto } from "@/lib/card-scan";
import { prepareImage } from "@/lib/image";
import { DEFAULT_SCAN_SESSION, LANGUAGES, SCAN_SESSION_KEY, scanErrorMessage, submitErrorMessage, type ScanSession } from "@/lib/scan";
import { useStored } from "@/lib/storage";
import { CONDITIONS, type AcquisitionLot, type Candidate, type CardCondition, type PositionDetail, type Received, type ScanResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type Phase = "idle" | "reading" | "form" | "done";
interface Entry {
  received: Received;
  name: string;
}

/** Une entrée en stock envoyée en arrière-plan : la saisie de la carte suivante n'attend pas sa réponse. */
interface Job {
  id: string;
  name: string;
  detail: string;
  status: "saving" | "saved" | "failed";
  error?: string;
  received?: Received;
  /** L'envoi, avec sa clé d'idempotence : le rejouer ne crée jamais de doublon. */
  send: () => Promise<Received>;
}

export default function ScannerPage() {
  return (
    <Suspense>
      <Scanner />
    </Suspense>
  );
}

/** Étape numérotée du formulaire ; la pastille se coche quand l'étape est renseignée. */
function Step({ n, title, done, aside, children, id, attention = false }: {
  n: number; title: string; done: boolean; aside?: ReactNode; children: ReactNode;
  /** Ancre de l'étape : le bouton de validation y mène quand elle manque. */
  id?: string;
  /** L'étape vient d'être signalée comme manquante : elle se détache un instant. */
  attention?: boolean;
}) {
  return (
    <Card id={id} className={cn("scroll-mt-20 transition-shadow duration-300", attention && "ring-2 ring-brand ring-offset-2 ring-offset-background")} data-attention={attention || undefined}>
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
  const [session, setSession, sessionReady] = useStored<ScanSession>(SCAN_SESSION_KEY, DEFAULT_SCAN_SESSION);
  const [phase, setPhase] = useState<Phase>("idle");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  /** La carte a été repérée sur la photo, redressée et recadrée. */
  const [cropped, setCropped] = useState(false);
  const [cropping, setCropping] = useState(false);
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
  const [jobs, setJobs] = useState<Job[]>([]);
  // Les envois partent l'un après l'autre : les codes de position suivent l'ordre de saisie, comme les cartes rangées.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const history: Entry[] = jobs.filter((j) => j.status === "saved").map((j) => ({ received: j.received!, name: j.name }));
  const latest = jobs[0] ?? null;
  const pendingJobs = jobs.filter((j) => j.status === "saving").length;
  // Quitter la page avec des envois en cours les perdrait : le navigateur demande confirmation.
  useEffect(() => {
    if (pendingJobs === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingJobs]);
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
  // Le recadrage des photos (OpenCV) se charge pendant qu'on prépare la carte, pas au moment de la photo.
  useEffect(preloadOpenCv, []);

  // Accolades obligatoires : scrollTo peut renvoyer une promesse, que React prendrait pour une fonction de nettoyage.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  const card = candidates.find((c) => c.catalogCardId === cardId) ?? null;
  const variant = card?.variants.find((v) => v.id === variantId) ?? null;
  const costCents = parseEuros(session.cost);
  // Ce qui manque pour valider, avec l'étape où le compléter.
  const gaps = ([
    !card && { label: t("la carte"), step: "etape-carte" },
    card && !variant && { label: t("la variante"), step: "etape-variante" },
    !condition && { label: t("l'état"), step: "etape-etat" },
    !session.locationCode && { label: t("l'emplacement"), step: "etape-rangement" },
    !bulkId && costCents === null && { label: t("un coût valide"), step: "etape-rangement" },
  ].filter(Boolean)) as { label: string; step: string }[];
  const missing = gaps.map((g) => g.label);
  const [attention, setAttention] = useState<string | null>(null);
  // Le signalement s'efface dès que l'étape est remplie, ou après quelques secondes.
  const gapSteps = gaps.map((g) => g.step).join(" ");
  useEffect(() => {
    if (!attention) return;
    if (!gapSteps.split(" ").includes(attention)) {
      setAttention(null);
      return;
    }
    const timer = setTimeout(() => setAttention(null), 2500);
    return () => clearTimeout(timer);
  }, [attention, gapSteps]);

  /** Valider avec une étape manquante : on y va, on la signale, et le premier choix prend le focus. */
  function goToMissing() {
    const first = gaps[0];
    if (!first) return;
    const section = document.getElementById(first.step);
    section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    section?.querySelector<HTMLElement>('[role="radio"], input, button:not([disabled])')?.focus({ preventScroll: true });
    setAttention(first.step);
  }

  function resetCard() {
    setScan(null);
    setScanError(null);
    setCandidates([]);
    setManual(false);
    setCardId(null);
    setVariantId(null);
    setCondition(session.condition || null);
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
    setCropped(false);
    setCropping(true);
    setPhase("reading");
    // La photo est « scannée » : carte repérée, redressée et recadrée ; à défaut, la photo d'origine part telle quelle.
    const scanned = await scanCardPhoto(file);
    if (scanned.cropped) {
      setPhotoUrl(URL.createObjectURL(scanned.blob));
      setCropped(true);
    }
    setCropping(false);
    try {
      const result = await api.scan(await prepareImage(scanned.blob), session.language);
      setScan(result);
      setCandidates(result.candidates);
      // Présélection uniquement quand l'identification est sûre ; sinon l'opérateur choisit explicitement.
      if (!result.requiresReview && result.candidates[0]) selectCard(result.candidates[0], result.suggestedVariantId);
      if (result.candidates.length === 0) setManual(true);
    } catch (e) {
      setScanError(scanErrorMessage(e));
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

  const updateJob = (id: string, change: Partial<Job>) => setJobs((all) => all.map((j) => (j.id === id ? { ...j, ...change } : j)));

  /** Met l'envoi en file ; il part dès que les précédents sont terminés. */
  function run(job: Job) {
    queue.current = queue.current.then(async () => {
      try {
        const received = await job.send();
        updateJob(job.id, { status: "saved", received, error: undefined });
        if (bulkId) api.position(bulkId).then(setBulk).catch(() => undefined);
      } catch (e) {
        updateJob(job.id, { status: "failed", error: submitErrorMessage(e) });
      }
    });
  }
  function retry(job: Job) {
    updateJob(job.id, { status: "saving", error: undefined });
    run(job);
  }

  /** Valider : l'entrée part en arrière-plan et l'écran revient aussitôt à la carte suivante. */
  function submit() {
    if (!card || !variant || !condition || missing.length || submitting) return;
    setSubmitting(true);
    const base = {
      variantId: variant.id,
      condition,
      quantity: unique ? 1 : quantity,
      locationCode: session.locationCode,
      unique: unique || undefined,
      draft: draft || undefined,
      photoIds: scan?.photo ? [scan.photo.id] : undefined,
    };
    // La clé d'idempotence est figée maintenant : un nouvel essai renvoie la même entrée, jamais une deuxième.
    const send = bulkId
      ? (() => { const key = keyring.current.keyFor({ bulkId, base }); return () => api.extract(bulkId, base, key); })()
      : (() => {
          const payload = { ...base, unitCostCents: costCents!, acquisitionLotId: session.lotId || undefined };
          const key = keyring.current.keyFor(payload);
          return () => api.receive(payload, key);
        })();
    const job: Job = {
      id: crypto.randomUUID(), name: card.name, status: "saving", send,
      detail: `${variantLabel(variant)} · ${condition}${base.quantity > 1 ? ` · × ${base.quantity}` : ""}`,
    };
    setJobs((all) => [job, ...all]);
    run(job);
    resetCard();
    setPhotoUrl(null);
    setPhase("done");
    setSubmitting(false);
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
          <Field label={t("Coût unitaire (€)")}>
            <Input
              inputMode="decimal"
              value={session.cost}
              onChange={(e) => setSession({ ...session, cost: e.target.value })}
              onFocus={(e) => e.target.select()}
              aria-invalid={costCents === null}
              className="tabular"
            />
          </Field>
          <Field label={t("Lot d'acquisition")}>
            <Select value={session.lotId} onChange={(e) => setSession({ ...session, lotId: e.target.value })}>
              <option value="">{t("Aucun")}</option>
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
      <strong>{t("Extraction du vrac")}</strong>{bulk ? ` — ${bulk.bulk?.label ?? bulk.unitSku} (${t("{n} cartes disponibles", { n: bulk.availableToSell })})` : ""}.{" "}
      <Link href={`/inventaire/${bulk?.unitSku ?? bulkId}`} className="font-medium underline underline-offset-2">{t("Retour au lot")}</Link>
    </Alert>
  );

  // ───────────────────────── Accueil du scanner et résultat ─────────────────────────

  if (phase === "idle" || phase === "done") {
    const sessionCards = history.reduce((n, e) => n + e.received.stockItem.onHand, 0);
    const latestSaved = latest?.status === "saved" ? { received: latest.received!, name: latest.name } : null;
    return (
      <div className="grid max-w-3xl gap-5">
        {fileInput}
        <PageHeader
          title={bulkId ? t("Extraire une carte") : t("Ajouter une carte")}
          description={bulkId ? t("Identifiez la carte sortie du lot, puis rangez-la.") : t("Photographiez une carte : elle est identifiée, vous confirmez, elle entre en stock.")}
        />
        {bulkBanner}
        {error && phase === "idle" && <Alert variant="destructive">{error}</Alert>}

        {phase === "done" && latest?.status === "saving" && (
          <Card className="overflow-hidden" aria-live="polite" data-testid="entry-saving">
            <CardContent className="flex items-center gap-3 py-4">
              <Spinner />
              <span className="min-w-0 flex-1 text-sm"><strong className="font-semibold">{latest.name}</strong> · {latest.detail} — {t("enregistrement en cours. Vous pouvez photographier la suivante.")}</span>
            </CardContent>
          </Card>
        )}
        {phase === "done" && latest?.status === "failed" && (
          <Alert variant="destructive">
            <span className="flex flex-wrap items-center gap-2">
              <span className="flex-1"><strong>{latest.name}</strong> {t("n'a pas pu être enregistrée : {error}", { error: latest.error ?? "" })}</span>
              <Button size="sm" variant="outline" onClick={() => retry(latest)}>{t("Réessayer")}</Button>
            </span>
          </Alert>
        )}
        {phase === "done" && latestSaved && (
          <Card className="overflow-hidden border-success/25" aria-live="polite">
            <div className="flex items-center gap-2 border-b border-success/15 bg-success-soft px-4 py-2.5 text-sm font-medium text-success sm:px-5">
              <Check className="size-4" strokeWidth={2.5} aria-hidden /> {t("Entrée en stock enregistrée.")}
            </div>
            <CardContent className="grid gap-3">
              <div className="flex items-end justify-between gap-3">
                <div className="grid gap-1">
                  <Eyebrow>{t("Code de la position")}</Eyebrow>
                  <p className="font-mono text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="unit-sku">{latestSaved.received.stockItem.unitSku}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void navigator.clipboard?.writeText(latestSaved.received.stockItem.unitSku).then(() => toast.success(t("Code copié")))}
                >
                  <Copy /> {t("Copier")}
                </Button>
              </div>
              <p className="text-sm">
                <strong className="font-semibold">{latestSaved.name}</strong> × {latestSaved.received.stockItem.onHand}, {t("rangé en")}{" "}
                <Code>{latestSaved.received.locationCode}</Code>
              </p>
              <p className="text-sm text-muted-foreground">
                {t("Notez ce code sur la pochette.")} {t("Offre")} <Code>{latestSaved.received.offer.offerSku}</Code>{" "}
                ({latestSaved.received.offer.created ? t("nouvelle") : t("existante, position ajoutée")}).
              </p>
              {latestSaved.received.pricing && (
                <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="entry-pricing">
                  <Badge variant={CATEGORY_VARIANT[latestSaved.received.pricing.category]}>{t(CATEGORY_LABEL[latestSaved.received.pricing.category])}</Badge>
                  {latestSaved.received.pricing.targetPriceCents !== null
                    ? <span>{t("Prix cible")} <strong className="tabular font-semibold">{formatEuros(latestSaved.received.pricing.targetPriceCents)}</strong></span>
                    : <span className="text-muted-foreground">
                        {latestSaved.received.pricing.reasons[0] ? t(reasonLabel(latestSaved.received.pricing.reasons[0])) : t("Prix à décider")} —{" "}
                        <Link href="/prix" className="font-medium text-primary underline-offset-2 hover:underline">{t("décider dans Prix")}</Link>
                      </span>}
                </p>
              )}
              {latestSaved.received.stockItem.lifecycle === "DRAFT" && (
                <Alert variant="warning">{t("Brouillon : non vendable tant qu'il n'est pas validé depuis sa fiche.")}</Alert>
              )}
              {latestSaved.received.variantIncomplete && (
                <Alert variant="warning">{t("Variante incomplète dans le catalogue : à confirmer avant toute publication.")}</Alert>
              )}
              <Button variant="link" size="sm" asChild className="justify-self-start">
                <Link href={`/inventaire/${latestSaved.received.stockItem.unitSku}`}>{t("Voir la fiche")} <ArrowRight /></Link>
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
              <Camera /> {phase === "done" ? t("Photographier la suivante") : t("Photographier une carte")}
            </Button>
            <Button variant="outline" size="lg" onClick={startManual} className="w-full">
              <Search /> {t("Rechercher sans photo")}
            </Button>
            {!bulkId && (
              <Button variant="link" size="sm" asChild className="justify-self-center">
                <Link href="/scanner/lot"><Images /> {t("Importer un lot d'images de scanner")}</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-1">
              <h2 className="text-[15px] font-semibold tracking-tight">{t("Réglages de la session")}</h2>
              <p className="text-sm text-muted-foreground">{t("Conservés d'une carte à l'autre.")}</p>
            </div>
            {storageFields}
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Langue par défaut")}>
                <Select value={session.language} onChange={(e) => setSession({ ...session, language: e.target.value })}>
                  {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}
                </Select>
              </Field>
              <Field label={t("État par défaut")}>
                <Select value={session.condition ?? ""} onChange={(e) => setSession({ ...session, condition: e.target.value as CardCondition | "" })}>
                  <option value="">{t("À choisir à chaque carte")}</option>
                  {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Avec un état par défaut, une carte reconnue à 100 % arrive avec sa fiche entièrement remplie : il ne reste qu'à valider.")}
            </p>
          </CardContent>
        </Card>

        {jobs.length > 0 && (
          <section className="grid gap-2" data-testid="session-entries">
            <div className="flex items-center justify-between px-1">
              <Eyebrow>{t("Cette session")}</Eyebrow>
              <span className="tabular text-xs text-muted-foreground">
                {tn(sessionCards, "{n} carte", "{n} cartes")}{pendingJobs > 0 ? ` · ${t("{n} en cours", { n: pendingJobs })}` : ""}
              </span>
            </div>
            <Card className="divide-y overflow-hidden">
              {jobs.map((j) => j.status === "saved" ? (
                <Link key={j.id} href={`/inventaire/${j.received!.stockItem.unitSku}`} className="flex items-center gap-3 px-4 py-3 text-sm outline-none hover:bg-accent focus-visible:bg-accent">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{j.name}</span>
                    <span className="flex gap-2 text-xs text-muted-foreground"><Code>{j.received!.stockItem.unitSku}</Code><Code>{j.received!.locationCode}</Code></span>
                  </span>
                  <span className="tabular font-semibold">× {j.received!.stockItem.onHand}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              ) : (
                <div key={j.id} className="flex items-center gap-3 px-4 py-3 text-sm" data-testid="session-entry-pending">
                  {j.status === "saving" ? <Spinner /> : <span className="size-2 rounded-full bg-destructive" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{j.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{j.status === "saving" ? `${j.detail} · ${t("enregistrement…")}` : j.error}</span>
                  </span>
                  {j.status === "failed" && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => retry(j)}>{t("Réessayer")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setJobs((all) => all.filter((x) => x.id !== j.id))}>{t("Retirer")}</Button>
                    </span>
                  )}
                </div>
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
      <div className="grid max-w-md gap-5">
        <PageHeader title={t("Lecture de la carte")} />
        <Card className="overflow-hidden">
          {photoUrl && (
            <div className="relative bg-muted">
              <img className="mx-auto max-h-[52dvh] w-full object-contain" src={photoUrl} alt={t("Photo prise")} />
              <div className="absolute inset-x-0 top-0 h-full animate-pulse bg-gradient-to-b from-primary/20 via-transparent to-transparent" aria-hidden />
            </div>
          )}
          <CardContent className="flex items-center gap-3" role="status">
            <Spinner className="size-5 text-primary" />
            <div className="grid">
              <span className="text-sm font-medium">{cropping ? t("Recadrage de la carte…") : t("Lecture du nom et du numéro…")}</span>
              <span className="text-xs text-muted-foreground">{t("Rapprochement avec le catalogue")}</span>
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
        title={bulkId ? t("Extraire une carte") : t("Confirmer la carte")}
        description={t("Vérifiez l'identification, puis précisez l'état et le rangement.")}
        actions={photoUrl && (
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><RotateCcw /> {t("Reprendre la photo")}</Button>
        )}
      />
      {bulkBanner}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid gap-5">
          <Step n={1} title={t("Carte")} done={!!card} id="etape-carte" attention={attention === "etape-carte"}>
            {(photoUrl || reading) && (
              <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-2.5">
                {photoUrl && <img className="aspect-[63/88] w-16 shrink-0 rounded-md object-cover ring-1 ring-border" src={photoUrl} alt={t("Photo prise")} />}
                {reading && (
                  <div className="grid gap-1 py-0.5">
                    <Eyebrow>{t("Lu sur la photo")}</Eyebrow>
                    <p className="text-sm font-medium">{read || t("rien de lisible")}</p>
                    {cropped && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="photo-cropped">
                        <Crop className="size-3.5" aria-hidden /> {t("Carte recadrée automatiquement")}
                      </span>
                    )}
                  </div>
                )}
                {cropped && !reading && (
                  <span className="inline-flex items-center gap-1 py-0.5 text-xs text-muted-foreground" data-testid="photo-cropped">
                    <Crop className="size-3.5" aria-hidden /> {t("Carte recadrée automatiquement")}
                  </span>
                )}
              </div>
            )}
            {scanError && <Alert variant="destructive">{scanError}</Alert>}
            {scan && !scan.requiresReview && (
              <Alert variant="success">
                <strong>{t("Identification sûre.")}</strong>{" "}
                {missing.length === 0 ? t("La fiche est remplie : vérifiez la variante et l'état, puis validez.") : t("Vérifiez tout de même la variante.")}
                {reading?.notes && <span className="block text-xs opacity-80">{t("Remarque de lecture : {notes}", { notes: reading.notes })}</span>}
              </Alert>
            )}
            {scan?.requiresReview && scan.candidates.length > 0 && (
              <Alert variant="warning">
                <strong>{t("À vérifier : choisissez la bonne carte.")}</strong>
                <ul className="mt-1 list-disc pl-4">
                  {scan.ambiguous && <li>{t("plusieurs cartes très proches")}</li>}
                  {scan.reviewReasons.map((r) => <li key={r}>{reviewReason(r)}</li>)}
                  {!scan.ambiguous && scan.reviewReasons.length === 0 && <li>{t("correspondance incertaine")}</li>}
                </ul>
              </Alert>
            )}
            {scan && scan.candidates.length === 0 && !scanError && (
              <Alert variant="warning">
                {t("Aucune carte du catalogue ne correspond à la lecture. Recherchez-la à la main, ou synchronisez sa série depuis")}{" "}
                <Link href="/catalogue" className="font-medium underline underline-offset-2">{t("le catalogue")}</Link>.
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
                {t("Aucune ne correspond : rechercher à la main")}
              </Button>
            )}
          </Step>

          <Step n={2} title={t("Variante")} done={!!variant} id="etape-variante" attention={attention === "etape-variante"}>
            {card ? (
              <div className="flex items-start gap-4">
                <CardThumb imageUrl={card.imageUrl} size="lg" />
                <div className="grid flex-1 gap-2">
                  <ChoiceGroup value={variantId} onValueChange={setVariantId} aria-label={t("Variante")}>
                    {card.variants.map((v) => (
                      <Choice key={v.id} value={v.id}>
                        {variantLabel(v)}
                        {v.incomplete && <span className="text-xs font-normal opacity-75">{t("à confirmer")}</span>}
                      </Choice>
                    ))}
                  </ChoiceGroup>
                  {card.variants.length === 0 && <Alert variant="warning">{t("Aucune variante connue pour cette carte : resynchronisez la série.")}</Alert>}
                  <p className="text-xs text-muted-foreground">{t("Normale, holo ou reverse : regardez où se trouve le brillant.")}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("Choisissez d'abord la carte.")}</p>
            )}
          </Step>
        </div>

        <div className="grid gap-5 lg:sticky lg:top-6">
          <Step n={3} title={t("État")} done={!!condition} id="etape-etat" attention={attention === "etape-etat"} aside={conditionLabel && <Badge variant="brand">{conditionLabel}</Badge>}>
            <ChoiceGroup value={condition} onValueChange={setCondition} aria-label={t("État")} className="grid grid-cols-7 gap-1.5">
              {CONDITIONS.map((c) => (
                <Choice key={c.code} value={c.code} aria-label={c.label} title={c.label} className="px-0 font-mono text-[13px]">
                  {c.code}
                </Choice>
              ))}
            </ChoiceGroup>
            <p className="text-xs text-muted-foreground">
              {session.condition ? t("Prérempli avec l'état par défaut de la session : corrigez-le si cette carte diffère.") : t("Évalué à la main, recto et verso.")}
            </p>
          </Step>

          <PriceEstimate variantId={variant?.id ?? null} condition={condition} unique={unique} />

          <Step n={4} title={t("Quantité")} done>
            <div className="flex items-center justify-between gap-4">
              <Stepper value={unique ? 1 : quantity} onChange={setQuantity} label={t("Quantité")} max={unique ? 1 : 10000} />
              <span className="text-xs text-muted-foreground">{unique ? t("Un seul exemplaire") : t("Exemplaires identiques")}</span>
            </div>
            <SwitchRow label={t("Exemplaire unique")} description={t("Forte valeur, vendu avec ses propres photos.")} checked={unique} onCheckedChange={setUnique} />
          </Step>

          <Step n={5} title={t("Rangement")} done={!!session.locationCode && (!!bulkId || costCents !== null)} id="etape-rangement" attention={attention === "etape-rangement"}>
            {storageFields}
            <SwitchRow label={t("Brouillon")} description={t("À revoir plus tard, non vendable d'ici là.")} checked={draft} onCheckedChange={setDraft} />
          </Step>

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="fixed inset-x-0 bottom-nav z-20 px-3 lg:static lg:px-0">
            <div className="flex gap-2 rounded-2xl border bg-popover/95 p-2 shadow-xl shadow-black/10 backdrop-blur-md lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
              <Button variant="outline" size="lg" onClick={() => { resetCard(); setPhase("idle"); }} disabled={submitting}>{t("Annuler")}</Button>
              <Button
                key={scan && missing.length === 0 ? "ready" : "pending"}
                autoFocus={!!scan && missing.length === 0}
                size="lg"
                onClick={missing.length > 0 ? goToMissing : submit}
                disabled={submitting}
                variant={missing.length > 0 ? "outline" : "default"}
                className="min-w-0 flex-1"
                data-testid="confirm"
              >
                {submitting ? <><Spinner className="text-primary-foreground" /> {t("Enregistrement…")}</>
                  : missing.length ? <span className="truncate">{t("Reste : {list}", { list: missing.join(", ") })}</span>
                  : bulkId ? <><Layers /> {t("Extraire et ranger")}</>
                  : <><Check strokeWidth={2.5} /> {t("Entrer en stock")}</>}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
