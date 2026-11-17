"use client";

import { ArrowLeft, Check, FolderOpen, FolderUp, PackagePlus, Pencil, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CandidateList, CardThumb, ManualSearch } from "@/components/card-chooser";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Code, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { ApiError, api } from "@/lib/api";
import { variantLabel } from "@/lib/format";
import { prepareImage } from "@/lib/image";
import { canWatchFolder, cardsFromFiles, cardsInFolder, pickFolder, readFolder, type FolderCard } from "@/lib/scan-source";
import { CONDITIONS, type Candidate, type CardCondition, type ScanBatch, type ScanItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const CONCURRENCY = 3;
const POLL_MS = 2000;
const ERRORS: Record<string, string> = {
  BATCH_NOT_READY: "Des cartes attendent encore une décision.",
  BATCH_ALREADY_RECEIVED: "Ce lot est déjà en stock.",
  LOCATION_NOT_FOUND: "Cette boîte n'existe pas.",
  NETWORK: "Connexion impossible. Les cartes déjà lues sont conservées : reliez le dossier à nouveau pour reprendre.",
};
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
const ignoredKey = (batchId: string) => `dexlane.scan.ignored.${batchId}`;

type Folder = NonNullable<Awaited<ReturnType<typeof pickFolder>>>;

export default function ScanBatchPage() {
  const { id } = useParams<{ id: string }>();
  const [batch, setBatch] = useState<ScanBatch | null>(null);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [onlyPending, setOnlyPending] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<ScanItem[]>([]);
  const queued = useRef(new Set<number>());
  const sizes = useRef(new Map<string, number>());
  const ignored = useRef(new Set<string>());
  const active = useRef(0);
  const waiting = useRef<FolderCard[]>([]);

  const put = useCallback((item: ScanItem) => {
    itemsRef.current = [...itemsRef.current.filter((i) => i.id !== item.id), item].sort((a, b) => a.position - b.position);
    setItems(itemsRef.current);
  }, []);
  const refresh = useCallback(async () => {
    const r = await api.scanBatch(id);
    setBatch(r.batch);
    itemsRef.current = r.items;
    setItems(r.items);
  }, [id]);
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
    try {
      ignored.current = new Set(JSON.parse(window.localStorage.getItem(ignoredKey(id)) ?? "[]") as string[]);
    } catch {
      ignored.current = new Set();
    }
  }, [id, refresh]);

  /** Envoie une carte (recto, puis verso) ; une carte déjà enregistrée à ce rang n'est pas relue. */
  const upload = useCallback(async (card: FolderCard) => {
    try {
      const known = itemsRef.current.find((i) => i.position === card.position);
      const item = known ?? (await api.addScanItem(id, card.position, card.front, await prepareImage(card.frontFile)));
      put(item);
      if (card.backFile && !item.backPhoto && !item.unitSku) put(await api.setScanItemBack(item.id, await prepareImage(card.backFile)).catch(() => item));
    } catch (e) {
      queued.current.delete(card.position); // sera repris au prochain passage
      setError(message(e));
    }
  }, [id, put]);

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && waiting.current.length > 0) {
      const card = waiting.current.shift()!;
      active.current++;
      setInFlight(active.current + waiting.current.length);
      void upload(card).finally(() => {
        active.current--;
        setInFlight(active.current + waiting.current.length);
        pump();
      });
    }
  }, [upload]);

  const enqueue = useCallback((cards: FolderCard[]) => {
    for (const card of cards) {
      const known = itemsRef.current.find((i) => i.position === card.position);
      if (known && known.fileName !== card.front) {
        setFolder(null);
        setError(`Le dossier ne correspond plus à ce lot : la carte ${card.position} était « ${known.fileName} », le dossier donne « ${card.front} ».`);
        return;
      }
      const complete = known && (!card.backFile || known.backPhoto || known.unitSku);
      if (complete || queued.current.has(card.position)) continue;
      queued.current.add(card.position);
      waiting.current.push(card);
    }
    pump();
  }, [pump]);

  // Dossier relié : toute nouvelle image du scanner est prise en charge dès qu'elle est entièrement écrite.
  useEffect(() => {
    if (!folder || !batch || batch.receivedAt) return;
    let stopped = false;
    const tick = async () => {
      try {
        const files = await readFolder(folder);
        if (!stopped) enqueue(cardsInFolder(files, ignored.current, sizes.current, batch.paired));
      } catch {
        if (!stopped) {
          setFolder(null);
          setError("Le dossier n'est plus accessible. Reliez-le à nouveau.");
        }
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [folder, batch, enqueue]);

  async function connect() {
    const picked = await pickFolder();
    if (!picked || !batch) return;
    setError(null);
    // Première liaison d'un lot vide : ce qui traîne déjà dans le dossier vient d'un lot précédent et n'est pas repris.
    if (itemsRef.current.length === 0 && !window.localStorage.getItem(ignoredKey(id))) {
      const present = [...(await readFolder(picked)).keys()];
      ignored.current = new Set(present);
      window.localStorage.setItem(ignoredKey(id), JSON.stringify(present));
      if (present.length > 0) toast.info(`${present.length} image${present.length > 1 ? "s" : ""} déjà dans le dossier, laissée${present.length > 1 ? "s" : ""} de côté. Les prochaines entrent dans ce lot.`);
    }
    sizes.current = new Map();
    setFolder(picked);
  }

  function addFiles(list: FileList) {
    if (!batch) return;
    setError(null);
    const files = [...list];
    if (batch.paired && files.length % 2 === 1) {
      setError(`Recto et verso attendus par paires, mais ${files.length} images ont été choisies. Vérifiez qu'il n'en manque pas une.`);
      return;
    }
    enqueue(cardsFromFiles(files, batch.paired, itemsRef.current.at(-1)?.position ?? 0));
  }

  async function change(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  const patchItem = (item: ScanItem, body: Parameters<typeof api.updateScanItem>[1]) => change(() => api.updateScanItem(item.id, body));

  async function receive() {
    setReceiving(true);
    setError(null);
    try {
      const r = await api.receiveScanBatch(id);
      toast.success(`${r.received} carte${r.received > 1 ? "s" : ""} en stock, de ${r.firstSku} à ${r.lastSku}`);
      setFolder(null);
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setReceiving(false);
    }
  }

  if (!batch) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> Chargement…</p>;

  const done = !!batch.receivedAt;
  const kept = items.filter((i) => !i.skipped);
  const pending = kept.filter((i) => !i.ready && !i.unitSku);
  const shown = onlyPending ? pending : items;
  const edited = items.find((i) => i.id === editing) ?? null;
  const first = items.find((i) => i.unitSku)?.unitSku;
  const last = [...items].reverse().find((i) => i.unitSku)?.unitSku;

  return (
    <div className="grid gap-4 pb-24">
      <Link href="/scanner/lot" className="flex items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
        <ArrowLeft className="size-3.5" aria-hidden /> Lots scannés
      </Link>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{batch.name}</h1>
        <p className="text-sm text-muted-foreground">
          Boîte <Code className="text-xs text-foreground">{batch.locationCode}</Code> · {batch.paired ? "recto verso" : "recto seul"}
        </p>
        {!done && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">État du lot</span>
            <Select
              value={batch.defaultCondition ?? ""}
              onChange={(e) => change(() => api.updateScanBatch(id, { defaultCondition: (e.target.value || null) as CardCondition | null }))}
              aria-label="État du lot"
              className="h-9 w-auto text-sm md:h-9"
            >
              <option value="">À choisir par carte</option>
              {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
            </Select>
          </div>
        )}
      </div>

      {done ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm" data-testid="batch-done">
          <Check className="size-4 text-success" strokeWidth={2.5} aria-hidden />
          <span>
            <strong className="font-semibold">{batch.counts.received} carte{batch.counts.received > 1 ? "s" : ""} en stock</strong>, dans l'ordre du scan :
            de <Code>{first}</Code> à <Code>{last}</Code>, boîte <Code>{batch.locationCode}</Code>.
          </span>
          <Button asChild variant="outline" size="sm" className="ml-auto"><Link href="/">Voir le stock</Link></Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
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
          {folder ? (
            <>
              <span className="relative flex size-2.5" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-success" />
              </span>
              <span className="text-sm" role="status">
                Dossier <strong className="font-medium">{folder.name}</strong> relié : {inFlight > 0 ? `lecture de ${inFlight} carte${inFlight > 1 ? "s" : ""}…` : "en attente des prochaines images."}
              </span>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setFolder(null)}>Arrêter</Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground" role="status">
                {inFlight > 0 ? <span className="flex items-center gap-2 text-foreground"><Spinner /> Lecture de {inFlight} carte{inFlight > 1 ? "s" : ""}…</span>
                  : canWatchFolder() ? "Reliez le dossier où le scanner enregistre ses images : chaque carte scannée arrive ici toute seule."
                  : "Ce navigateur ne sait pas suivre un dossier (utilisez Chrome ou Edge). Choisissez les images une fois le scan terminé."}
              </span>
              {canWatchFolder() && <Button onClick={connect}><FolderOpen /> Relier le dossier du scanner</Button>}
              <Button variant="outline" onClick={() => fileRef.current?.click()}><FolderUp /> Choisir des images</Button>
            </>
          )}
        </div>
      )}

      {error && <p role="alert" data-slot="alert" data-variant="destructive" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="batch-counts">
            <span className="tabular text-muted-foreground">
              {kept.length} carte{kept.length > 1 ? "s" : ""}{batch.counts.skipped > 0 ? ` · ${batch.counts.skipped} écartée${batch.counts.skipped > 1 ? "s" : ""}` : ""}
            </span>
            {!done && pending.length > 0 && (
              <button
                type="button"
                aria-pressed={onlyPending}
                onClick={() => setOnlyPending(!onlyPending)}
                className={cn("flex h-7 items-center gap-1.5 rounded-md border px-2 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30", onlyPending && "bg-accent")}
              >
                <span className="size-2 rounded-full bg-brand" aria-hidden /> {pending.length} à corriger
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="h-9 w-12 px-3 text-right font-medium">N°</th>
                  <th className="w-24 px-3 font-medium">Scan</th>
                  <th className="px-3 font-medium">Carte</th>
                  <th className="hidden w-56 px-3 font-medium md:table-cell">Variante</th>
                  <th className="hidden w-32 px-3 font-medium sm:table-cell">État</th>
                  <th className="w-36 px-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => {
                  const variant = item.card?.variants.find((v) => v.id === item.variantId);
                  const attention = !item.skipped && !item.ready && !item.unitSku;
                  return (
                    <tr key={item.id} data-testid="batch-row" data-status={item.unitSku ? "received" : item.skipped ? "skipped" : item.ready ? "ready" : "pending"}
                      className={cn("border-b last:border-b-0", item.skipped && "opacity-45", attention && "bg-brand-soft/40")}>
                      <td className={cn("tabular border-l-2 px-3 text-right text-xs text-muted-foreground", attention ? "border-l-brand" : "border-l-transparent")}>{item.position}</td>
                      <td className="px-3 py-1.5">
                        <button type="button" onClick={() => setEditing(item.id)} disabled={done} aria-label={`Voir le scan ${item.position}`} className="flex gap-1 rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                          {[item.frontPhoto, item.backPhoto].map((p, side) => p && (
                            <img key={p.id} src={p.url} alt={side === 0 ? "Recto" : "Verso"} loading="lazy" className="aspect-[63/88] w-8 rounded-[3px] bg-muted object-cover ring-1 ring-border" />
                          ))}
                          {!item.frontPhoto && <span className="flex aspect-[63/88] w-8 items-center justify-center rounded-[3px] bg-muted text-[10px] text-muted-foreground">?</span>}
                        </button>
                      </td>
                      <td className="px-3">
                        {item.card ? (
                          <span className="flex items-center gap-2.5">
                            <CardThumb imageUrl={item.card.imageUrl} size="sm" className="w-8 rounded-[3px]" />
                            <span className="grid min-w-0">
                              <span className="truncate font-medium">{item.card.name}</span>
                              <span className="truncate text-xs text-muted-foreground">{item.card.setName ?? item.card.setId} · {item.card.localNumber}{!item.sure ? " · choisie à la main" : ""}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="grid">
                            <span className="font-medium">{item.scanError ? "Lecture impossible" : "Carte à choisir"}</span>
                            <span className="truncate text-xs text-muted-foreground">{item.candidates.length > 0 ? `${item.candidates.length} proposition${item.candidates.length > 1 ? "s" : ""}` : "À rechercher dans le catalogue"} · {item.fileName}</span>
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 md:table-cell">
                        {item.unitSku || item.skipped ? <span className="text-muted-foreground">{variant ? variantLabel(variant) : "—"}</span> : item.card && (
                          <Select value={item.variantId ?? ""} onChange={(e) => patchItem(item, { variantId: e.target.value })} aria-label={`Variante de la carte ${item.position}`} aria-invalid={!variant} className="h-8 text-[13px] md:h-8">
                            {!variant && <option value="">À choisir…</option>}
                            {item.card.variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="hidden px-3 sm:table-cell">
                        {item.unitSku || item.skipped ? <span className="font-mono text-xs text-muted-foreground">{item.condition ?? batch.defaultCondition ?? "—"}</span> : (
                          <Select value={item.condition ?? ""} onChange={(e) => patchItem(item, { condition: (e.target.value || null) as CardCondition | null })} aria-label={`État de la carte ${item.position}`} aria-invalid={!item.condition && !batch.defaultCondition} className="h-8 text-[13px] md:h-8">
                            <option value="">{batch.defaultCondition ?? "À choisir…"}</option>
                            {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                          </Select>
                        )}
                      </td>
                      <td className="px-3 text-right whitespace-nowrap">
                        {item.unitSku ? (
                          <Link href={`/inventaire/${item.unitSku}`} className="font-mono text-xs font-medium underline-offset-2 outline-none hover:underline focus-visible:underline" data-testid="batch-sku">{item.unitSku}</Link>
                        ) : item.skipped ? (
                          <Button variant="ghost" size="sm" onClick={() => patchItem(item, { skipped: false })}><Undo2 /> Reprendre</Button>
                        ) : (
                          <>
                            <Button variant={item.card ? "ghost" : "outline"} size="sm" onClick={() => setEditing(item.id)} aria-label={item.card ? `Corriger la carte ${item.position}` : undefined}>
                              <Pencil /> {!item.card && "Choisir"}
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => patchItem(item, { skipped: true })} aria-label={`Écarter la carte ${item.position}`} title="Écarter du lot"><X /></Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!done && items.length > 0 && (
        <div className="fixed inset-x-0 bottom-nav z-20 px-3 lg:bottom-0 lg:left-56 lg:px-8 lg:pb-4">
          <div className="mx-auto flex max-w-[92rem] items-center gap-3 rounded-lg border bg-popover px-4 py-2.5 shadow-lg">
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {inFlight > 0 ? "Lecture en cours…" : pending.length > 0 ? `Reste ${pending.length} carte${pending.length > 1 ? "s" : ""} à corriger avant l'entrée en stock.` : "Tout est prêt. Les codes suivront l'ordre du scan."}
            </p>
            <Button onClick={receive} disabled={receiving || inFlight > 0 || pending.length > 0 || kept.length === 0} data-testid="batch-save">
              {receiving ? <Spinner className="text-primary-foreground" /> : <PackagePlus />} Entrer {kept.length} carte{kept.length > 1 ? "s" : ""} en stock
            </Button>
          </div>
        </div>
      )}

      {edited && !done && (
        <ItemEditor item={edited} language={batch.language} batchCondition={batch.defaultCondition} onClose={() => setEditing(null)} onSave={(body) => patchItem(edited, body).then(() => setEditing(null))} />
      )}
    </div>
  );
}

/** Correction d'une carte : le scan en grand, les propositions de la lecture, la recherche manuelle, la variante. */
function ItemEditor({ item, language, batchCondition, onClose, onSave }: {
  item: ScanItem;
  language: string;
  batchCondition: CardCondition | null;
  onClose: () => void;
  onSave: (body: { catalogCardId: string; variantId: string | null; condition: CardCondition | null }) => Promise<void>;
}) {
  const [condition, setCondition] = useState<CardCondition | null>(item.condition);
  const [candidates, setCandidates] = useState<Candidate[]>(item.candidates);
  const [manual, setManual] = useState(item.candidates.length === 0);
  const [cardId, setCardId] = useState(item.card?.id ?? null);
  const [variantId, setVariantId] = useState(item.variantId);
  const variants = candidates.find((c) => c.catalogCardId === cardId)?.variants ?? (cardId === item.card?.id ? item.card.variants : []);

  return (
    <Modal title={`Carte n° ${item.position}`} description={item.fileName} onClose={onClose}>
      <div className="flex justify-center gap-2 rounded-md bg-muted/50 p-2">
        {[item.frontPhoto, item.backPhoto].map((p, side) => p && <img key={p.id} src={p.url} alt={side === 0 ? "Recto scanné" : "Verso scanné"} className="max-h-64 min-w-0 rounded object-contain ring-1 ring-border" />)}
      </div>
      {item.reviewReasons.length > 0 && <p className="text-[13px] text-muted-foreground">Lecture incertaine : {item.reviewReasons.join(", ")}.</p>}
      {candidates.length > 0 && (
        <CandidateList
          candidates={candidates}
          selectedId={cardId}
          onSelect={(c) => {
            setCardId(c.catalogCardId);
            setVariantId(c.variants.length === 1 ? c.variants[0]!.id : null);
          }}
        />
      )}
      {manual ? (
        <ManualSearch
          language={language}
          onResults={(found) => {
            setCandidates(found);
            setCardId(null);
            setVariantId(null);
          }}
        />
      ) : (
        <Button variant="link" size="sm" onClick={() => setManual(true)} className="justify-self-start">Aucune ne correspond : rechercher à la main</Button>
      )}
      {cardId && variants.length > 1 && (
        <div className="grid gap-1.5">
          <span className="text-[13px] leading-none font-medium text-foreground/80">Variante</span>
          <ChoiceGroup value={variantId} onValueChange={setVariantId} aria-label="Variante">
            {variants.map((v) => <Choice key={v.id} value={v.id}>{variantLabel(v)}</Choice>)}
          </ChoiceGroup>
        </div>
      )}
      <label className="grid gap-1.5">
        <span className="text-[13px] leading-none font-medium text-foreground/80">État de cette carte</span>
        <Select value={condition ?? ""} onChange={(e) => setCondition((e.target.value || null) as CardCondition | null)}>
          <option value="">{batchCondition ? `Celui du lot (${batchCondition})` : "À choisir…"}</option>
          {CONDITIONS.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
        </Select>
      </label>
      <Button size="lg" disabled={!cardId} onClick={() => onSave({ catalogCardId: cardId!, variantId, condition })}>
        <Check strokeWidth={2.5} /> Utiliser cette carte
      </Button>
    </Modal>
  );
}
