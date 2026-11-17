"use client";

import { ArrowLeft, Check, CircleAlert, Copy, FolderUp, Images, PackagePlus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { CandidateList, CardThumb, ManualSearch } from "@/components/card-chooser";
import { LocationField } from "@/components/location-picker";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Code, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { SwitchRow } from "@/components/ui/switch";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { prepareImage } from "@/lib/image";
import { DEFAULT_SCAN_SESSION, LANGUAGES, SCAN_SESSION_KEY, scanErrorMessage, submitErrorMessage, type ScanSession } from "@/lib/scan";
import { useStored } from "@/lib/storage";
import { CONDITIONS, type AcquisitionLot, type Candidate, type CardCondition, type Received } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Lectures menées de front : assez pour ne pas attendre, sans saturer le service de lecture. */
const CONCURRENCY = 2;

type Status = "queued" | "reading" | "read" | "saving" | "saved";

/** Une carte du lot : son image de recto (et de verso), ce qui a été lu, ce que l'opérateur a décidé. */
interface Row {
  id: string;
  front: File;
  back: File | null;
  preview: string;
  backPreview: string | null;
  status: Status;
  /** Lecture sûre : la carte et la variante ont été présélectionnées. */
  sure: boolean;
  scanError: string | null;
  saveError: string | null;
  photoIds: string[];
  photoKept: boolean;
  language: string;
  candidates: Candidate[];
  cardId: string | null;
  variantId: string | null;
  /** null : l'état par défaut du lot s'applique. */
  condition: CardCondition | null;
  received: Received | null;
}

const byName = (a: File, b: File) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
const cardOf = (row: Row) => row.candidates.find((c) => c.catalogCardId === row.cardId) ?? null;
const variantOf = (row: Row) => cardOf(row)?.variants.find((v) => v.id === row.variantId) ?? null;

function pickVariant(card: Candidate, suggested: string | null): string | null {
  if (suggested && card.variants.some((v) => v.id === suggested)) return suggested;
  return card.variants.length === 1 ? card.variants[0]!.id : null;
}

export default function BatchScanPage() {
  const [session, setSession, sessionReady] = useStored<ScanSession>(SCAN_SESSION_KEY, DEFAULT_SCAN_SESSION);
  const [rows, setRows] = useState<Row[]>([]);
  const [paired, setPaired] = useState(false);
  const [defaultCondition, setDefaultCondition] = useState<CardCondition | null>(null);
  const [lots, setLots] = useState<AcquisitionLot[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(new Set<string>());
  const keyrings = useRef(new Map<string, ReturnType<typeof createKeyring>>());
  const urls = useRef(new Set<string>());

  useEffect(() => {
    api.lots().then((r) => setLots(r.lots)).catch(() => setLots([]));
    const created = urls.current;
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patch = (id: string, change: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const costCents = parseEuros(session.cost);
  const conditionOf = (row: Row) => row.condition ?? defaultCondition;
  const isReady = (row: Row) => row.status === "read" && !!variantOf(row) && !!conditionOf(row);
  const counts = useMemo(() => {
    const pending = rows.filter((r) => r.status === "queued" || r.status === "reading").length;
    const saved = rows.filter((r) => r.status === "saved");
    return { pending, saved };
  }, [rows]);
  const ready = rows.filter(isReady);
  const toReview = rows.filter((r) => r.status === "read" && !variantOf(r));
  const unsaved = rows.some((r) => r.status !== "saved");

  // Quitter la page avec des cartes lues mais non entrées en stock ferait perdre le travail de vérification.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  function addFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name)).sort(byName);
    setError(null);
    if (files.length === 0) {
      setError("Aucune image exploitable. Réglez le scanner pour produire des fichiers JPEG ou PNG, un par carte.");
      return;
    }
    if (paired && files.length % 2 === 1) {
      setError(`Recto et verso attendus par paires, mais ${files.length} images ont été déposées. Vérifiez qu'il n'en manque pas une.`);
      return;
    }
    const preview = (file: File) => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return url;
    };
    const added: Row[] = [];
    for (let i = 0; i < files.length; i += paired ? 2 : 1) {
      const front = files[i]!;
      const back = paired ? files[i + 1]! : null;
      added.push({
        id: crypto.randomUUID(), front, back, preview: preview(front), backPreview: back && preview(back), status: "queued", sure: false,
        scanError: null, saveError: null, photoIds: [], photoKept: true, language: session.language, candidates: [], cardId: null,
        variantId: null, condition: null, received: null,
      });
    }
    setRows((all) => [...all, ...added]);
  }

  async function read(row: Row) {
    patch(row.id, { status: "reading" });
    const photoIds: string[] = [];
    let change: Partial<Row>;
    let frontBlob: Blob | null = null;
    try {
      frontBlob = await prepareImage(row.front);
      const result = await api.scan(frontBlob, session.language);
      if (result.photo) photoIds.push(result.photo.id);
      // Présélection uniquement quand l'identification est sûre ; sinon l'opérateur choisit explicitement.
      const top = !result.requiresReview ? result.candidates[0] : undefined;
      change = {
        sure: !!top, language: result.language, candidates: result.candidates,
        cardId: top?.catalogCardId ?? null, variantId: top ? pickVariant(top, result.suggestedVariantId) : null,
      };
    } catch (e) {
      change = { scanError: scanErrorMessage(e) };
      // La lecture a échoué, pas forcément le stockage : l'image reste utile pour l'annonce.
      if (frontBlob) await api.uploadPhoto(frontBlob, "SCAN_FRONT").then((p) => photoIds.push(p.id)).catch(() => undefined);
    }
    if (row.back) {
      await prepareImage(row.back).then((blob) => api.uploadPhoto(blob, "SCAN_BACK")).then((p) => photoIds.push(p.id)).catch(() => undefined);
    }
    patch(row.id, { ...change, status: "read", photoIds, photoKept: photoIds.length === (row.back ? 2 : 1) });
  }

  // File de lecture : une nouvelle image part dès qu'une place se libère.
  useEffect(() => {
    const running = rows.filter((r) => r.status === "reading").length;
    const next = rows.find((r) => r.status === "queued" && !started.current.has(r.id));
    if (next && running < CONCURRENCY) {
      started.current.add(next.id);
      void read(next);
    }
  });

  function retry(row: Row) {
    started.current.delete(row.id);
    patch(row.id, { status: "queued", scanError: null, candidates: [], cardId: null, variantId: null, sure: false });
  }

  function remove(row: Row) {
    setRows((all) => all.filter((r) => r.id !== row.id));
  }

  /** Entre en stock les cartes prêtes, dans l'ordre du scanner : les codes se suivent comme la pile de cartes. */
  async function save() {
    if (costCents === null || !session.locationCode) return;
    setSaving(true);
    setError(null);
    for (const row of ready) {
      const variant = variantOf(row)!;
      const payload = {
        variantId: variant.id, condition: conditionOf(row)!, quantity: 1, locationCode: session.locationCode,
        unitCostCents: costCents, acquisitionLotId: session.lotId || undefined, photoIds: row.photoIds.length ? row.photoIds : undefined,
      };
      let keyring = keyrings.current.get(row.id);
      if (!keyring) keyrings.current.set(row.id, (keyring = createKeyring()));
      patch(row.id, { status: "saving", saveError: null });
      try {
        const received = await api.receive(payload, keyring.keyFor(payload));
        patch(row.id, { status: "saved", received, condition: payload.condition });
      } catch (e) {
        // Une erreur de réseau ou d'emplacement toucherait aussi les suivantes : on s'arrête là.
        const message = submitErrorMessage(e);
        patch(row.id, { status: "read", saveError: message });
        setError(`Entrée interrompue à « ${cardOf(row)?.name} » : ${message}`);
        break;
      }
    }
    setSaving(false);
  }

  function copyCodes() {
    const lines = counts.saved.map((r, i) => {
      const card = cardOf(r)!;
      return [i + 1, r.received!.stockItem.unitSku, card.name, `${card.setName ?? card.setId} ${card.localNumber}`, r.received!.offer.offerSku].join("\t");
    });
    void navigator.clipboard?.writeText(lines.join("\n")).then(() => toast.success("Liste copiée"));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  const missing = [
    !session.locationCode && "l'emplacement",
    costCents === null && "un coût valide",
    ready.length === 0 && rows.some((r) => r.status === "read" && variantOf(r)) && !defaultCondition && "l'état des cartes",
  ].filter(Boolean) as string[];
  const storageOff = rows.some((r) => r.status !== "queued" && r.status !== "reading" && !r.photoKept);
  const edited = rows.find((r) => r.id === editing) ?? null;

  return (
    <div className="grid gap-5 pb-24 lg:pb-0">
      <Button variant="ghost" size="sm" asChild className="-ml-2 justify-self-start text-muted-foreground">
        <Link href="/ajouter"><ArrowLeft /> Ajouter une carte</Link>
      </Button>
      <PageHeader
        title="Scan en lot"
        description="Déposez les images sorties du scanner à défilement, une carte par image : elles sont lues, vous vérifiez, tout entre en stock d'un coup."
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="batch-input"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Card
            className={cn("border-dashed bg-gradient-to-b from-brand-soft/60 to-card transition-colors", dragging && "border-primary bg-brand-soft")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <CardContent className={cn("grid justify-items-center gap-3 text-center", rows.length ? "py-5" : "py-8")}>
              {rows.length === 0 && (
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden><Images className="size-7" /></div>
              )}
              <Button size={rows.length ? "lg" : "xl"} onClick={() => fileRef.current?.click()} disabled={!sessionReady || saving}>
                <FolderUp /> {rows.length ? "Ajouter des images" : "Choisir les images"}
              </Button>
              <p className="max-w-md text-sm text-muted-foreground">
                Ou glissez-les ici. Elles sont traitées dans l'ordre de leur nom de fichier, c'est-à-dire l'ordre de passage dans le scanner.
              </p>
            </CardContent>
          </Card>

          {error && <Alert variant="destructive">{error}</Alert>}
          {storageOff && (
            <Alert variant="warning">Le stockage des photos n'est pas disponible : les cartes entrent en stock, mais leurs images ne sont pas conservées.</Alert>
          )}

          {rows.length > 0 && (
            <section className="grid gap-2" aria-label="Cartes du lot">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <Eyebrow>{rows.length} carte{rows.length > 1 ? "s" : ""}</Eyebrow>
                <div className="flex flex-wrap items-center gap-1.5" data-testid="batch-counts">
                  {counts.pending > 0 && <Badge variant="neutral"><Spinner className="size-3" /> {counts.pending} en lecture</Badge>}
                  {toReview.length > 0 && <Badge variant="warning">{toReview.length} à vérifier</Badge>}
                  {ready.length > 0 && <Badge variant="brand">{ready.length} prête{ready.length > 1 ? "s" : ""}</Badge>}
                  {counts.saved.length > 0 && <Badge variant="success">{counts.saved.length} en stock</Badge>}
                  {counts.saved.length > 0 && <Button variant="outline" size="sm" onClick={copyCodes}><Copy /> Copier la liste</Button>}
                </div>
              </div>
              <Card className="divide-y overflow-hidden">
                {rows.map((row, index) => (
                  <BatchRow
                    key={row.id}
                    row={row}
                    index={index}
                    defaultCondition={defaultCondition}
                    disabled={saving}
                    onEdit={() => setEditing(row.id)}
                    onRetry={() => retry(row)}
                    onRemove={() => remove(row)}
                    onVariant={(variantId) => patch(row.id, { variantId })}
                    onCondition={(condition) => patch(row.id, { condition })}
                  />
                ))}
              </Card>
            </section>
          )}
        </div>

        <div className="grid gap-5 lg:sticky lg:top-6">
          <Card>
            <CardContent className="grid gap-4">
              <div className="grid gap-1">
                <h2 className="text-[15px] font-semibold tracking-tight">Réglages du lot</h2>
                <p className="text-sm text-muted-foreground">Appliqués à toutes les cartes de ce lot.</p>
              </div>
              <div className="grid gap-1.5">
                <span className="text-[13px] leading-none font-medium text-foreground/80">État des cartes</span>
                <ChoiceGroup value={defaultCondition} onValueChange={setDefaultCondition} aria-label="État des cartes" className="grid grid-cols-7 gap-1.5">
                  {CONDITIONS.map((c) => (
                    <Choice key={c.code} value={c.code} aria-label={c.label} title={c.label} className="px-0 font-mono text-[13px]">{c.code}</Choice>
                  ))}
                </ChoiceGroup>
                <span className="text-xs text-muted-foreground">Évalué à la main, jamais prérempli. Modifiable carte par carte.</span>
              </div>
              <LocationField value={session.locationCode} onChange={(code) => setSession({ ...session, locationCode: code })} />
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
              <Field label="Langue par défaut des cartes">
                <Select value={session.language} onChange={(e) => setSession({ ...session, language: e.target.value })}>
                  {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </Select>
              </Field>
              <SwitchRow
                label="Recto et verso"
                description="Le scanner produit deux images par carte : recto puis verso."
                checked={paired}
                onCheckedChange={setPaired}
                disabled={saving}
              />
            </CardContent>
          </Card>

          <div className="fixed inset-x-0 bottom-nav z-20 px-3 lg:static lg:px-0">
            <div className="rounded-2xl border bg-popover/95 p-2 shadow-xl shadow-black/10 backdrop-blur-md lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
              <Button size="lg" onClick={save} disabled={saving || ready.length === 0 || missing.length > 0} className="w-full" data-testid="batch-save">
                {saving ? <><Spinner className="text-primary-foreground" /> Entrée en stock…</>
                  : missing.length ? <span className="truncate">Reste : {missing.join(", ")}</span>
                  : ready.length === 0 ? "Aucune carte prête"
                  : <><PackagePlus /> Entrer {ready.length} carte{ready.length > 1 ? "s" : ""} en stock</>}
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Réglage conseillé du scanner : JPEG couleur, 300 ppp ou plus, un fichier par carte. Les PDF et TIFF ne sont pas lus.
          </p>
        </div>
      </div>

      {edited && (
        <CardEditor
          row={edited}
          onClose={() => setEditing(null)}
          onChange={(change) => patch(edited.id, change)}
        />
      )}
    </div>
  );
}

function BatchRow({ row, index, defaultCondition, disabled, onEdit, onRetry, onRemove, onVariant, onCondition }: {
  row: Row;
  index: number;
  defaultCondition: CardCondition | null;
  disabled: boolean;
  onEdit: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onVariant: (variantId: string) => void;
  onCondition: (condition: CardCondition | null) => void;
}) {
  const card = cardOf(row);
  const variant = variantOf(row);
  const busy = row.status === "queued" || row.status === "reading" || row.status === "saving";
  const scans = (
    <span className="flex shrink-0 gap-1">
      <img className="aspect-[63/88] w-11 rounded-[5px] bg-muted object-cover ring-1 ring-border" src={row.preview} alt={`Recto, ${row.front.name}`} />
      {row.backPreview && <img className="aspect-[63/88] w-11 rounded-[5px] bg-muted object-cover ring-1 ring-border" src={row.backPreview} alt={`Verso, ${row.back!.name}`} />}
    </span>
  );
  const number = <span className="tabular w-6 shrink-0 text-right text-xs text-muted-foreground">{index + 1}</span>;

  if (row.status === "saved" && row.received && card) {
    const pricing = row.received.pricing;
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4" data-testid="batch-row" data-status="saved">
        {number}
        {scans}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{card.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {card.setName ?? card.setId} · n° {card.localNumber} · {variant ? variantLabel(variant) : ""} · {row.condition}
            {pricing?.targetPriceCents != null && ` · ${formatEuros(pricing.targetPriceCents)}`}
          </span>
        </span>
        <Link
          href={`/inventaire/${row.received.stockItem.unitSku}`}
          className="rounded-md bg-success-soft px-2 py-1 font-mono text-sm font-semibold text-success outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/30"
          data-testid="batch-sku"
        >
          {row.received.stockItem.unitSku}
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5 px-3 py-3 sm:px-4" data-testid="batch-row" data-status={card && variant ? "ready" : row.status}>
      <div className="flex items-center gap-3">
        {number}
        {scans}
        {busy && !card ? (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground" role="status">
            {row.status === "reading" ? <><Spinner className="text-primary" /> Lecture…</> : "En attente"}
            <span className="truncate text-xs">{row.front.name}</span>
          </span>
        ) : card ? (
          <>
            <CardThumb imageUrl={card.imageUrl} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{card.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{card.setName ?? card.setId} · n° {card.localNumber}{card.rarity ? ` · ${card.rarity}` : ""}</span>
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-sm font-medium text-warning"><CircleAlert className="size-4" aria-hidden /> {row.scanError ? "Lecture impossible" : "Carte à choisir"}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {row.scanError ?? (row.candidates.length ? `${row.candidates.length} carte${row.candidates.length > 1 ? "s" : ""} possible${row.candidates.length > 1 ? "s" : ""}` : "Aucune correspondance dans le catalogue")}
            </span>
          </span>
        )}
        {!busy && (
          <span className="flex shrink-0 gap-1">
            <Button variant={card ? "ghost" : "outline"} size={card ? "icon-sm" : "sm"} onClick={onEdit} disabled={disabled} aria-label={card ? `Changer la carte ${index + 1}` : undefined}>
              <Pencil /> {!card && "Choisir"}
            </Button>
            {row.scanError && (
              <Button variant="ghost" size="icon-sm" onClick={onRetry} disabled={disabled} aria-label={`Relire l'image ${index + 1}`}><RotateCcw /></Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onRemove} disabled={disabled} aria-label={`Retirer la carte ${index + 1}`}><Trash2 /></Button>
          </span>
        )}
        {row.status === "saving" && <Spinner className="text-primary" />}
      </div>

      {card && row.status !== "saving" && (
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2 pl-9">
          <Select
            value={row.variantId ?? ""}
            onChange={(e) => onVariant(e.target.value)}
            disabled={disabled}
            aria-label={`Variante de la carte ${index + 1}`}
            aria-invalid={!variant}
            className="h-9 text-sm md:h-9"
          >
            {!variant && <option value="">Variante à choisir…</option>}
            {card.variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}{v.incomplete ? " (à confirmer)" : ""}</option>)}
          </Select>
          <Select
            value={row.condition ?? ""}
            onChange={(e) => onCondition((e.target.value || null) as CardCondition | null)}
            disabled={disabled}
            aria-label={`État de la carte ${index + 1}`}
            className="h-9 text-sm md:h-9"
          >
            <option value="">{defaultCondition ? `État du lot (${defaultCondition})` : "État du lot"}</option>
            {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
          </Select>
        </div>
      )}
      {row.saveError && <p className="pl-9 text-xs text-destructive">{row.saveError}</p>}
      {card && !row.sure && !row.saveError && row.status === "read" && (
        <p className="pl-9 text-xs text-muted-foreground">Choisie à la main.</p>
      )}
    </div>
  );
}

/** Choix de la carte d'une ligne : propositions de la lecture, ou recherche manuelle, à côté de l'image scannée. */
function CardEditor({ row, onClose, onChange }: { row: Row; onClose: () => void; onChange: (change: Partial<Row>) => void }) {
  const [candidates, setCandidates] = useState(row.candidates);
  const [manual, setManual] = useState(row.candidates.length === 0);
  const [cardId, setCardId] = useState(row.cardId);
  const card = candidates.find((c) => c.catalogCardId === cardId) ?? null;
  const [variantId, setVariantId] = useState(row.variantId);

  function select(c: Candidate) {
    setCardId(c.catalogCardId);
    setVariantId(pickVariant(c, null));
  }

  return (
    <Modal title="Choisir la carte" description={row.front.name} onClose={onClose}>
      <div className="grid gap-4">
        <div className="flex justify-center gap-2 rounded-lg bg-muted/50 p-2.5">
          <img className="max-h-56 rounded-md object-contain ring-1 ring-border" src={row.preview} alt="Recto scanné" />
          {row.backPreview && <img className="max-h-56 rounded-md object-contain ring-1 ring-border" src={row.backPreview} alt="Verso scanné" />}
        </div>
        {row.scanError && <Alert variant="warning">{row.scanError}</Alert>}
        {candidates.length > 0 && <CandidateList candidates={candidates} selectedId={cardId} onSelect={select} />}
        {manual ? (
          <ManualSearch
            language={row.language}
            onResults={(found) => {
              setCandidates(found);
              setCardId(null);
              setVariantId(null);
            }}
          />
        ) : (
          <Button variant="link" size="sm" onClick={() => setManual(true)} className="justify-self-start">Aucune ne correspond : rechercher à la main</Button>
        )}
        {card && card.variants.length > 1 && (
          <div className="grid gap-1.5">
            <span className="text-[13px] leading-none font-medium text-foreground/80">Variante</span>
            <ChoiceGroup value={variantId} onValueChange={setVariantId} aria-label="Variante">
              {card.variants.map((v) => <Choice key={v.id} value={v.id}>{variantLabel(v)}</Choice>)}
            </ChoiceGroup>
          </div>
        )}
        <Button
          size="lg"
          disabled={!card}
          onClick={() => {
            onChange({ candidates, cardId, variantId, sure: false });
            onClose();
          }}
        >
          <Check strokeWidth={2.5} /> Utiliser cette carte
        </Button>
      </div>
    </Modal>
  );
}
