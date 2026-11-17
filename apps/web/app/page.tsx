"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { CandidateList, CardThumb, ManualSearch } from "@/components/CardChooser";
import { LocationPicker } from "@/components/LocationPicker";
import { Stepper } from "@/components/Stepper";
import { ApiError, api, createKeyring } from "@/lib/api";
import { parseEuros, reviewReason, variantLabel } from "@/lib/format";
import { prepareImage } from "@/lib/image";
import { useStored } from "@/lib/storage";
import { CONDITIONS, type AcquisitionLot, type Candidate, type CardCondition, type PositionDetail, type Received, type ScanResult } from "@/lib/types";

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
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const keyring = useRef(createKeyring());

  useEffect(() => {
    if (bulkId) api.position(bulkId).then(setBulk).catch((e: Error) => setError(e.message));
    else api.lots().then((r) => setLots(r.lots)).catch(() => setLots([]));
  }, [bulkId]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  // Chaque étape commence en haut de page (le résultat d'une entrée s'affiche sous le titre, pas hors écran).
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

  const sessionFields = (
    <div className="stack-sm">
      <div className="field">
        <span className="label" id="location-label">Emplacement</span>
        <button type="button" className="btn" aria-labelledby="location-label" onClick={() => setPicking(true)} style={{ justifyContent: "space-between" }}>
          <span className={session.locationCode ? "mono" : "muted"}>{session.locationCode || "Choisir…"}</span>
          <span className="muted small">Changer</span>
        </button>
      </div>
      {!bulkId && (
        <div className="grid-2">
          <label className="field">
            <span>Coût unitaire (€)</span>
            <input
              className="input"
              inputMode="decimal"
              value={session.cost}
              onChange={(e) => setSession({ ...session, cost: e.target.value })}
              onFocus={(e) => e.target.select()}
              aria-invalid={costCents === null}
            />
          </label>
          <label className="field">
            <span>Lot d'acquisition</span>
            <select className="input" value={session.lotId} onChange={(e) => setSession({ ...session, lotId: e.target.value })}>
              <option value="">Aucun</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>{l.purchaseDate} · {l.sourceType}{l.sellerRef ? ` · ${l.sellerRef}` : ""}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );

  const bulkBanner = bulkId && (
    <p className="banner info">
      <strong>Extraction du vrac</strong>{bulk ? ` — ${bulk.bulk?.label ?? bulk.unitSku} (${bulk.availableToSell} cartes disponibles)` : ""}.{" "}
      <Link href={`/inventaire/${bulk?.unitSku ?? bulkId}`} style={{ textDecoration: "underline" }}>Retour au lot</Link>
    </p>
  );

  const picker = picking && (
    <LocationPicker
      value={session.locationCode}
      onClose={() => setPicking(false)}
      onPick={(code) => {
        setSession({ ...session, locationCode: code });
        setPicking(false);
      }}
    />
  );

  if (phase === "idle" || phase === "done") {
    return (
      <div className="stack">
        {fileInput}
        {picker}
        <h1>{bulkId ? "Extraire une carte" : "Scanner"}</h1>
        {bulkBanner}
        {error && phase === "idle" && <p className="banner error" role="alert">{error}</p>}

        {phase === "done" && last && (
          <section className="card stack-sm" aria-live="polite">
            <p className="banner ok"><strong>Entrée en stock enregistrée.</strong></p>
            <p className="sku" data-testid="unit-sku">{last.received.stockItem.unitSku}</p>
            <p>
              <strong>{last.name}</strong> × {last.received.stockItem.onHand}, rangé en{" "}
              <span className="mono">{last.received.locationCode}</span>
            </p>
            <p className="muted small">
              Notez ce code sur la pochette. Offre <span className="mono">{last.received.offer.offerSku}</span>{" "}
              ({last.received.offer.created ? "nouvelle" : "existante, position ajoutée"}).
            </p>
            {last.received.stockItem.lifecycle === "DRAFT" && (
              <p className="banner warn">Brouillon : non vendable tant qu'il n'est pas validé depuis sa fiche.</p>
            )}
            {last.received.variantIncomplete && (
              <p className="banner warn">Variante incomplète dans le catalogue : à confirmer avant toute publication.</p>
            )}
            <Link className="btn ghost sm" href={`/inventaire/${last.received.stockItem.unitSku}`}>Voir la fiche</Link>
          </section>
        )}

        <button type="button" className="btn primary big block" onClick={() => fileRef.current?.click()} disabled={!sessionReady}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          </svg>
          {phase === "done" ? "Photographier la suivante" : "Photographier une carte"}
        </button>
        <button type="button" className="btn block" onClick={startManual}>Rechercher sans photo</button>

        <section className="card stack-sm">
          <h2 className="section-title">Réglages de la session</h2>
          {sessionFields}
          <label className="field">
            <span>Langue par défaut des cartes</span>
            <select className="input" value={session.language} onChange={(e) => setSession({ ...session, language: e.target.value })}>
              {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
        </section>

        {history.length > 0 && (
          <section className="stack-sm">
            <h2 className="section-title">Cette session · {history.reduce((n, e) => n + e.received.stockItem.onHand, 0)} cartes</h2>
            <div className="list">
              {history.map((e) => (
                <Link key={e.received.stockItem.id} className="rowlink" href={`/inventaire/${e.received.stockItem.unitSku}`}>
                  <span className="grow truncate"><strong>{e.name}</strong> <span className="muted small mono">{e.received.stockItem.unitSku}</span></span>
                  <span className="muted small mono">{e.received.locationCode}</span>
                  <span className="qty">{e.received.stockItem.onHand}</span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  if (phase === "reading") {
    return (
      <div className="stack">
        <h1>Lecture de la carte</h1>
        {photoUrl && <img className="photo" src={photoUrl} alt="Photo prise" />}
        <p className="row" role="status"><span className="spinner" /> Lecture du nom et du numéro…</p>
      </div>
    );
  }

  const reading = scan?.reading;
  return (
    <div className="stack">
      {fileInput}
      {picker}
      <h1>{bulkId ? "Extraire une carte" : "Confirmer la carte"}</h1>
      {bulkBanner}

      <section className="card stack-sm">
        <h2 className="section-title">Carte</h2>
        {(photoUrl || reading) && (
          <div className="row" style={{ alignItems: "flex-start" }}>
            {photoUrl && <img className="photo small" src={photoUrl} alt="Photo prise" />}
            {reading && (
              <p className="grow small">
                <span className="muted">Lu sur la photo : </span>
                {[reading.name, reading.collector_number, reading.set_code, scan?.language.toUpperCase()].filter(Boolean).join(" · ") || "rien de lisible"}
              </p>
            )}
          </div>
        )}
        {scanError && <p className="banner error" role="alert">{scanError}</p>}
        {scan && !scan.requiresReview && (
          <p className="banner ok"><strong>Identification sûre.</strong> Vérifiez tout de même la variante.</p>
        )}
        {scan?.requiresReview && scan.candidates.length > 0 && (
          <div className="banner warn" role="status">
            <strong>À vérifier : choisissez la bonne carte.</strong>
            <ul>
              {scan.ambiguous && <li>plusieurs cartes très proches</li>}
              {scan.reviewReasons.map((r) => <li key={r}>{reviewReason(r)}</li>)}
              {!scan.ambiguous && scan.reviewReasons.length === 0 && <li>correspondance incertaine</li>}
            </ul>
          </div>
        )}
        {scan && scan.candidates.length === 0 && !scanError && (
          <p className="banner warn" role="status">
            Aucune carte du catalogue ne correspond à la lecture. Recherchez-la à la main, ou synchronisez sa série depuis{" "}
            <Link href="/catalogue" style={{ textDecoration: "underline" }}>le catalogue</Link>.
          </p>
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
          <button type="button" className="btn ghost sm" onClick={() => setManual(true)}>Aucune ne correspond : rechercher à la main</button>
        )}
      </section>

      {card && (
        <section className="card stack-sm">
          <h2 className="section-title">Variante</h2>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <CardThumb imageUrl={card.imageUrl} large />
            <div className="chips grow" role="radiogroup" aria-label="Variante">
              {card.variants.map((v) => (
                <button key={v.id} type="button" role="radio" aria-checked={v.id === variantId} className="chip" onClick={() => setVariantId(v.id)}>
                  {variantLabel(v)}{v.incomplete && <small>à confirmer</small>}
                </button>
              ))}
              {card.variants.length === 0 && <p className="banner warn">Aucune variante connue pour cette carte : resynchronisez la série.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="card stack-sm">
        <h2 className="section-title">État</h2>
        <div className="conditions" role="radiogroup" aria-label="État">
          {CONDITIONS.map((c) => (
            <button key={c.code} type="button" role="radio" aria-checked={c.code === condition} className="chip" title={c.label} aria-label={c.label} onClick={() => setCondition(c.code)}>
              {c.code}
            </button>
          ))}
        </div>
        <p className="muted small">{CONDITIONS.find((c) => c.code === condition)?.label ?? "Évalué à la main, recto et verso."}</p>
      </section>

      <section className="card stack-sm">
        <h2 className="section-title">Quantité</h2>
        <div className="spread">
          <Stepper value={unique ? 1 : quantity} onChange={setQuantity} label="Quantité" max={unique ? 1 : 10000} />
          <label className="check">
            <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
            <span>Exemplaire unique<span className="muted small" style={{ display: "block" }}>forte valeur, vendu avec ses propres photos</span></span>
          </label>
        </div>
      </section>

      <section className="card stack-sm">
        <h2 className="section-title">Rangement</h2>
        {sessionFields}
        <label className="check">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          <span>Brouillon<span className="muted small" style={{ display: "block" }}>à revoir plus tard, non vendable d'ici là</span></span>
        </label>
      </section>

      {error && <p className="banner error" role="alert">{error}</p>}

      <div className="actionbar">
        <button type="button" className="btn" onClick={() => { resetCard(); setPhase("idle"); }} disabled={submitting}>Annuler</button>
        <button type="button" className="btn primary" onClick={submit} disabled={submitting || missing.length > 0}>
          {submitting ? "Enregistrement…" : missing.length ? `Reste : ${missing.join(", ")}` : bulkId ? "Extraire et ranger" : "Entrer en stock"}
        </button>
      </div>
    </div>
  );
}
