"use client";

import { Check, Copy, ImagePlus, Megaphone, RefreshCw, Search, ShoppingCart, Upload, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TITLE_MAX, VARIABLES, buildListingText, type ListingSubject } from "@dexlane/listings/template";
import { CardThumb } from "@/components/card-chooser";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Code, EmptyState, Loading, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { Pagination } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { BACKGROUND_PRESETS, backgroundCss, composeListingPhoto, drawListingPhoto, loadBitmap, placeholderCard } from "@/lib/compose";
import { formatDateTime, formatEuros } from "@/lib/format";
import { prepareImage } from "@/lib/image";
import type { ChannelId, ChannelMode, ChannelState, ListingBlocker, ListingOffer, ListingSettings, ListingState, Photo, PhotoStyle } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const ERRORS: Record<string, string> = {
  PHOTO_STORAGE_UNAVAILABLE: "Le stockage des photos n'est pas configuré.",
  CHANNEL_DISABLED: "Ce canal est désactivé : activez-le dans Réglages → Canaux de vente.",
  CHANNEL_NOT_CONFIGURED: "Le connecteur réel de ce canal n'est pas encore configuré. Utilisez la simulation en attendant.",
  LISTING_NOT_READY: "Cette offre n'est pas prête : il lui manque un prix, une photo ou une variante confirmée.",
  OFFER_NOT_SELLABLE: "Cette offre n'a plus de stock vendable.",
  LISTING_NOT_FOUND: "Cette annonce n'existe plus.",
};
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);
const BLOCKERS: Record<ListingBlocker, string> = { PRICE: "Prix à décider", PHOTO: "Photo manquante", VARIANT: "Variante à confirmer" };
const isScan = (p: Photo) => p.kind === "SCAN_FRONT" || p.kind === "SCAN_BACK";

/** Carte d'exemple pour l'aperçu du modèle. */
const SAMPLE: ListingSubject = {
  name: "Dracaufeu", localNumber: "004", setId: "base1", setName: "Set de Base", serieName: "Wizards", officialCount: 102, language: "fr",
  rarity: "Rare", finish: "holo", edition: "", subtype: "", stamp: "", condition: "NM", offerSku: "OF-BASE1-004-FR-H-NM", targetPriceCents: 25000,
};

// ───────────────────────── Offres ─────────────────────────

/** Image de fond des visuels, chargée une fois par réglage. */
function useBackgroundImage(style: PhotoStyle): { image: ImageBitmap | null; ready: boolean } {
  const photoId = style.background.type === "image" ? style.background.photoId : null;
  const [state, setState] = useState<{ id: string | null; image: ImageBitmap | null }>({ id: null, image: null });
  useEffect(() => {
    if (!photoId) return;
    let cancelled = false;
    loadBitmap(api.photoContentUrl(photoId))
      .then((image) => !cancelled && setState({ id: photoId, image }))
      .catch(() => !cancelled && setState({ id: photoId, image: null }));
    return () => {
      cancelled = true;
    };
  }, [photoId]);
  return photoId ? { image: state.id === photoId ? state.image : null, ready: state.id === photoId } : { image: null, ready: true };
}

export function Offers({ settings, channels }: { settings: ListingSettings; channels: ChannelState[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: ListingOffer[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const background = useBackgroundImage(settings.photo);

  const load = useCallback(() => {
    api.listingOffers({ q: query.trim() || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [query, page]);
  useEffect(() => {
    const timer = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  /** Compose (ou recompose) le visuel d'annonce de chaque scan de l'offre. */
  async function compose(offers: ListingOffer[]) {
    setError(null);
    let done = 0;
    try {
      for (const offer of offers) {
        setComposing(offer.offerId);
        for (const scan of offer.photos.filter(isScan)) {
          const card = await loadBitmap(api.photoContentUrl(scan.id));
          await api.uploadListingPhoto(await composeListingPhoto(card, settings.photo, background.image), scan.id);
          card.close();
          done++;
        }
      }
      toast.success(`${done} photo${done > 1 ? "s" : ""} d'annonce composée${done > 1 ? "s" : ""}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setComposing(null);
      load();
    }
  }

  const missing = (data?.items ?? []).filter((o) => o.photos.some(isScan) && !o.photos.some((p) => p.kind === "LISTING"));

  /** Action sur un canal (publier, retirer, simuler un achat) : le message de succès, puis la liste à jour. */
  async function act(action: () => Promise<string>) {
    setError(null);
    try {
      toast.success(await action());
    } catch (e) {
      setError(message(e));
    } finally {
      load();
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Nom de carte ou référence d'offre"
            aria-label="Rechercher une offre"
            className="pl-9"
          />
        </div>
        {missing.length > 0 && (
          <Button variant="outline" onClick={() => compose(missing)} disabled={!!composing || !background.ready}>
            {composing ? <Spinner /> : <Wand2 />} Composer les photos manquantes ({missing.length})
          </Button>
        )}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {channels.length === 0 && data && data.items.length > 0 && (
        <Alert variant="info">Aucun canal de vente n'est activé. Réglages → Canaux de vente permet d'essayer tout le circuit en simulation, sans rien publier.</Alert>
      )}
      {!data ? <Loading />
        : data.items.length === 0 ? (
          <EmptyState icon={<Megaphone />} title={query ? "Aucune offre ne correspond" : "Aucune offre vendable"}>
            Une annonce est préparée pour chaque offre qui a du stock vendable. Entrez des cartes en stock et validez leurs brouillons.
          </EmptyState>
        ) : (
          <>
            <div className="grid gap-3">
              {data.items.map((offer) => (
                <OfferCard
                  key={offer.offerId}
                  offer={offer}
                  channels={channels}
                  busy={composing === offer.offerId}
                  disabled={!!composing || !background.ready}
                  onCompose={() => compose([offer])}
                  onAct={act}
                />
              ))}
            </div>
            <Pagination page={page} pageCount={Math.ceil(data.total / PAGE_SIZE)} onChange={setPage} />
          </>
        )}
    </div>
  );
}

function copy(text: string, what: string) {
  void navigator.clipboard?.writeText(text).then(() => toast.success(`${what} copié${what === "Description" ? "e" : ""}`));
}

const LISTING_STATUS: Record<ListingState["status"], { label: string; variant: "success" | "warning" | "destructive" | "neutral" }> = {
  ACTIVE: { label: "En ligne", variant: "success" },
  PAUSED: { label: "En pause, stock épuisé", variant: "warning" },
  ERROR: { label: "Erreur de synchronisation", variant: "destructive" },
  PENDING: { label: "En attente", variant: "neutral" },
  ENDED: { label: "Terminée", variant: "neutral" },
};

/** État d'une offre sur un canal activé, et les actions possibles. */
function ChannelRow({ offer, channel, onAct }: { offer: ListingOffer; channel: ChannelState; onAct: (action: () => Promise<string>) => void }) {
  const listing = offer.listings.find((l) => l.channel === channel.id);
  const simulated = listing ? listing.simulated : channel.mode === "SIMULATION";
  const publish = () => onAct(async () => {
    await api.publishListing(offer.offerId, channel.id);
    return listing ? `Annonce ${channel.label} mise à jour` : `Publiée sur ${channel.label}${simulated ? " (simulation)" : ""}`;
  });
  const outdated = listing && offer.targetPriceCents !== null && listing.priceCents !== offer.targetPriceCents;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2" data-testid={`channel-${channel.id}`}>
      <span className="text-sm font-semibold">{channel.label}</span>
      {simulated && <Badge variant="outline">Simulation</Badge>}
      {listing ? (
        <>
          <Badge variant={LISTING_STATUS[listing.status].variant}>{LISTING_STATUS[listing.status].label}</Badge>
          <span className="tabular text-xs text-muted-foreground">{listing.quantitySent} annoncée{listing.quantitySent > 1 ? "s" : ""} · {formatEuros(listing.priceCents)}</span>
          {outdated && <Badge variant="warning">Prix modifié depuis</Badge>}
          {listing.url && <a href={listing.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline-offset-2 hover:underline">Voir l'annonce</a>}
          <span className="ml-auto flex flex-wrap gap-1.5">
            {listing.simulated && listing.status === "ACTIVE" && (
              <Button variant="outline" size="sm" onClick={() => onAct(async () => `Commande ${(await api.simulateOrder(listing.id)).externalId} reçue : à préparer dans Ventes`)}>
                <ShoppingCart /> Simuler un achat
              </Button>
            )}
            {offer.available > 0 && <Button variant="outline" size="sm" onClick={publish}><RefreshCw /> Mettre à jour</Button>}
            <Button variant="ghost" size="sm" onClick={() => onAct(async () => { await api.endListing(listing.id); return `Annonce ${channel.label} retirée`; })}>
              <X /> Retirer
            </Button>
          </span>
        </>
      ) : (
        <>
          {offer.missing.map((m) => <Badge key={m} variant="warning">{BLOCKERS[m]}</Badge>)}
          <Button size="sm" onClick={publish} disabled={offer.missing.length > 0} className="ml-auto">
            <Megaphone /> Publier sur {channel.label}
          </Button>
        </>
      )}
    </div>
  );
}

function OfferCard({ offer, channels, busy, disabled, onCompose, onAct }: {
  offer: ListingOffer;
  channels: ChannelState[];
  busy: boolean;
  disabled: boolean;
  onCompose: () => void;
  onAct: (action: () => Promise<string>) => void;
}) {
  const listingPhotos = offer.photos.filter((p) => p.kind === "LISTING");
  const scans = offer.photos.filter(isScan);
  const shown = listingPhotos.length ? listingPhotos : scans;
  return (
    <Card data-testid={`listing-${offer.offerSku}`}>
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 gap-1.5">
            {shown.length === 0 && <CardThumb imageUrl={offer.imageUrl} size="md" />}
            {shown.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                <img
                  src={p.url}
                  alt={p.kind === "LISTING" ? "Photo d'annonce" : "Scan"}
                  loading="lazy"
                  className={cn("w-16 rounded-md bg-muted object-cover ring-1 ring-border sm:w-20", p.kind === "LISTING" ? "aspect-square" : "aspect-[63/88]")}
                />
              </a>
            ))}
          </div>
          <div className="grid min-w-0 flex-1 gap-1.5">
            <p className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]" data-testid="listing-title">{offer.text.title}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("tabular", offer.text.warnings.includes("TITLE_TOO_LONG") && "font-medium text-warning")}>{offer.text.title.length}/{TITLE_MAX}</span>
              <span>·</span>
              <span className="tabular font-medium text-foreground">{offer.targetPriceCents === null ? "Prix à décider" : formatEuros(offer.targetPriceCents)}</span>
              <span>·</span>
              <span>{offer.available} en stock</span>
              <Code className="text-muted-foreground">{offer.offerSku}</Code>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {offer.text.warnings.includes("TITLE_TOO_LONG") && <Badge variant="warning">Titre raccourci</Badge>}
              {offer.text.warnings.includes("UNKNOWN_VARIABLE") && <Badge variant="warning">Variable inconnue dans le modèle</Badge>}
              {offer.variantIncomplete && <Badge variant="warning">Variante à confirmer</Badge>}
              {scans.length === 0 ? <Badge variant="outline">Sans photo de l'exemplaire</Badge>
                : listingPhotos.length === 0 ? <Badge variant="outline">Photos à composer</Badge>
                : <Badge variant="success"><Check /> {listingPhotos.length} photo{listingPhotos.length > 1 ? "s" : ""} d'annonce</Badge>}
            </div>
          </div>
        </div>
        {channels.length > 0 && (
          <div className="grid gap-2">
            {channels.map((channel) => <ChannelRow key={channel.id} offer={offer} channel={channel} onAct={onAct} />)}
          </div>
        )}
        <details className="group rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground outline-none select-none group-open:mb-2 focus-visible:underline">Description</summary>
          <p className="whitespace-pre-wrap" data-testid="listing-description">{offer.text.description}</p>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copy(offer.text.title, "Titre")}><Copy /> Titre</Button>
          <Button variant="outline" size="sm" onClick={() => copy(offer.text.description, "Description")}><Copy /> Description</Button>
          {scans.length > 0 && (
            <Button variant="outline" size="sm" onClick={onCompose} disabled={disabled} aria-label={`${listingPhotos.length ? "Recomposer" : "Composer"} les photos de ${offer.offerSku}`}>
              {busy ? <Spinner /> : <Wand2 />} {listingPhotos.length ? "Recomposer les photos" : "Composer les photos"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Modèle ─────────────────────────

export function TemplateEditor({ settings, onSaved }: { settings: ListingSettings; onSaved: (s: ListingSettings) => void }) {
  const [title, setTitle] = useState(settings.titleTemplate);
  const [description, setDescription] = useState(settings.descriptionTemplate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef<"title" | "description">("title");
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => buildListingText(SAMPLE, { titleTemplate: title, descriptionTemplate: description }), [title, description]);
  const dirty = title !== settings.titleTemplate || description !== settings.descriptionTemplate;

  /** Insère la variable à l'endroit du curseur, dans le champ qui avait le focus. */
  function insert(key: string) {
    const field = focused.current === "title" ? titleRef.current : descriptionRef.current;
    const [value, set] = focused.current === "title" ? [title, setTitle] : [description, setDescription];
    const start = field?.selectionStart ?? value.length;
    const end = field?.selectionEnd ?? value.length;
    const token = `{${key}}`;
    set(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.saveListingSettings({ ...settings, titleTemplate: title, descriptionTemplate: description }));
      toast.success("Modèle enregistré");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <Card>
        <CardContent className="grid gap-4">
          <Field label="Modèle de titre" hint={`${TITLE_MAX} caractères au plus une fois rempli : au-delà, le titre est coupé au dernier mot.`}>
            <Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => (focused.current = "title")} spellCheck={false} />
          </Field>
          <Field label="Modèle de description" hint="Une ligne dont les variables sont vides (rareté inconnue, par exemple) est retirée de l'annonce.">
            <Textarea ref={descriptionRef} value={description} onChange={(e) => setDescription(e.target.value)} onFocus={() => (focused.current = "description")} rows={11} spellCheck={false} />
          </Field>
          <div className="grid gap-2">
            <Eyebrow>Variables — cliquez pour insérer</Eyebrow>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insert(v.key)}
                  title={`${v.label} — ex. ${v.example}`}
                  className="rounded-md border bg-card px-2 py-1 font-mono text-xs shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30"
                >
                  {`{${v.key}}`}
                </button>
              ))}
            </div>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button onClick={save} disabled={saving || !dirty} className="justify-self-start">
            {saving ? <Spinner className="text-primary-foreground" /> : <Check />} Enregistrer le modèle
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-6">
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Aperçu sur une carte d'exemple</Eyebrow>
            <span className={cn("tabular text-xs", preview.warnings.includes("TITLE_TOO_LONG") ? "font-medium text-warning" : "text-muted-foreground")}>
              {preview.title.length}/{TITLE_MAX}
            </span>
          </div>
          <p className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]" data-testid="template-preview-title">{preview.title}</p>
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap" data-testid="template-preview-description">{preview.description}</p>
          {preview.warnings.includes("TITLE_TOO_LONG") && <Alert variant="warning">Titre trop long pour cette carte : il a été coupé à {TITLE_MAX} caractères.</Alert>}
          {preview.warnings.includes("UNKNOWN_VARIABLE") && <Alert variant="warning">Une variable entre accolades n'existe pas : elle resterait telle quelle dans l'annonce.</Alert>}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── Photos ─────────────────────────

const sameBackground = (a: PhotoStyle["background"], b: PhotoStyle["background"]) => JSON.stringify(a) === JSON.stringify(b);

export function PhotoStyleEditor({ settings, onSaved }: { settings: ListingSettings; onSaved: (s: ListingSettings) => void }) {
  const [style, setStyle] = useState<PhotoStyle>(settings.photo);
  const [sample, setSample] = useState<ImageBitmap | HTMLCanvasElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const background = useBackgroundImage(style);
  const patch = (change: Partial<PhotoStyle>) => setStyle((s) => ({ ...s, ...change }));

  // Aperçu sur un vrai scan s'il en existe un, sinon sur une carte factice.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<ImageBitmap | HTMLCanvasElement> => {
      const { items } = await api.listingOffers({ limit: 20 });
      const scan = items.flatMap((o) => o.photos).find((p) => p.kind === "SCAN_FRONT");
      return scan ? loadBitmap(api.photoContentUrl(scan.id)) : placeholderCard();
    };
    load().catch(() => placeholderCard()).then((card) => !cancelled && setSample(card));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (canvasRef.current && sample && background.ready) drawListingPhoto(canvasRef.current, sample, style, background.image);
  }, [sample, style, background.image, background.ready]);

  async function uploadBackground(file: File) {
    setUploading(true);
    setError(null);
    try {
      const photo = await api.uploadPhoto(await prepareImage(file), "BACKGROUND");
      patch({ background: { type: "image", photoId: photo.id } });
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.saveListingSettings({ ...settings, photo: style }));
      toast.success("Style des photos enregistré");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  const promoRef = useRef<HTMLInputElement>(null);
  /** Image de fin d'annonce : enregistrée tout de suite, elle ne dépend pas du style des photos. */
  async function setPromo(file: File | null) {
    setUploading(true);
    setError(null);
    try {
      const promoPhotoId = file ? (await api.uploadPhoto(await prepareImage(file), "PROMO")).id : null;
      onSaved(await api.saveListingSettings({ ...settings, promoPhotoId }));
      toast.success(file ? "Image de fin d'annonce enregistrée" : "Image de fin d'annonce retirée");
    } catch (e) {
      setError(message(e));
    } finally {
      setUploading(false);
    }
  }

  const b = style.background;
  const dirty = JSON.stringify(style) !== JSON.stringify(settings.photo);
  const range = "h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary";

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <Card>
        <CardContent className="grid gap-5">
          <div className="grid gap-2">
            <Eyebrow>Fond</Eyebrow>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Fond des photos">
              {BACKGROUND_PRESETS.map((preset) => {
                const selected = sameBackground(preset.background, b);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={preset.name}
                    title={preset.name}
                    onClick={() => patch({ background: preset.background })}
                    className={cn(
                      "grid gap-1 rounded-lg p-1 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30",
                      selected && "bg-brand-soft text-primary",
                    )}
                  >
                    <span className={cn("aspect-square rounded-md ring-1 ring-border", selected && "ring-2 ring-primary")} style={{ background: backgroundCss(preset.background) }} />
                    {preset.name}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Type de fond">
                <Select
                  value={b.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    if (type === "color") patch({ background: { type: "color", color: b.type === "gradient" ? b.from : b.type === "color" ? b.color : "#0f172a" } });
                    else if (type === "gradient") patch({ background: { type: "gradient", from: b.type === "color" ? b.color : "#1e293b", to: "#0f172a", angle: 135 } });
                    else fileRef.current?.click();
                  }}
                >
                  <option value="color">Couleur unie</option>
                  <option value="gradient">Dégradé</option>
                  <option value="image">Image</option>
                </Select>
              </Field>
              {b.type === "color" && (
                <Field label="Couleur"><Input type="color" value={b.color} onChange={(e) => patch({ background: { ...b, color: e.target.value } })} className="p-1" /></Field>
              )}
              {b.type === "gradient" && (
                <>
                  <Field label="Couleur de départ"><Input type="color" value={b.from} onChange={(e) => patch({ background: { ...b, from: e.target.value } })} className="p-1" /></Field>
                  <Field label="Couleur d'arrivée"><Input type="color" value={b.to} onChange={(e) => patch({ background: { ...b, to: e.target.value } })} className="p-1" /></Field>
                  <Field label={`Angle : ${b.angle}°`}><input type="range" min={0} max={360} step={15} value={b.angle} onChange={(e) => patch({ background: { ...b, angle: Number(e.target.value) } })} className={cn(range, "mt-3.5")} /></Field>
                </>
              )}
              <div className="col-span-2 self-end sm:col-span-1">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  data-testid="background-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void uploadBackground(file);
                  }}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full">
                  {uploading ? <Spinner /> : b.type === "image" ? <ImagePlus /> : <Upload />} {b.type === "image" ? "Changer l'image" : "Votre image"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Votre propre fond (tapis de jeu, bois, tissu) : une photo carrée d'au moins 1600 px rend le mieux.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Marge autour de la carte : ${style.marginPercent} %`}>
              <input type="range" min={0} max={25} step={1} value={style.marginPercent} onChange={(e) => patch({ marginPercent: Number(e.target.value) })} className={cn(range, "mt-2")} />
            </Field>
            <Field label={`Rognage du bord du scan : ${style.trimPercent} %`} hint="Retire le liseré laissé par le scanner.">
              <input type="range" min={0} max={8} step={0.5} value={style.trimPercent} onChange={(e) => patch({ trimPercent: Number(e.target.value) })} className={cn(range, "mt-2")} />
            </Field>
            <Field label="Texte en bas de l'image" hint="Pseudo de vendeur, par exemple. Facultatif.">
              <Input value={style.caption} maxLength={60} onChange={(e) => patch({ caption: e.target.value })} />
            </Field>
            <Field label="Taille de l'image">
              <Select value={style.size} onChange={(e) => patch({ size: Number(e.target.value) })}>
                <option value={1200}>1200 × 1200 px</option>
                <option value={1600}>1600 × 1600 px (conseillé)</option>
                <option value={2000}>2000 × 2000 px</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 sm:gap-6">
            <SwitchRow label="Coins arrondis" description="Masque les coins du scan au format de la carte." checked={style.roundCorners} onCheckedChange={(roundCorners) => patch({ roundCorners })} />
            <SwitchRow label="Ombre portée" description="Détache la carte du fond." checked={style.shadow} onCheckedChange={(shadow) => patch({ shadow })} />
          </div>

          <div className="grid gap-2 border-t pt-5" data-testid="promo">
            <Eyebrow>Image de fin d'annonce</Eyebrow>
            <p className="text-sm text-muted-foreground">Ajoutée en dernière photo de chaque annonce : « On rachète vos cartes », vos conditions d'envoi, votre logo…</p>
            <div className="flex flex-wrap items-center gap-3">
              {settings.promoPhotoId && <img src={api.photoContentUrl(settings.promoPhotoId)} alt="Image de fin d'annonce" className="size-20 rounded-md bg-muted object-cover ring-1 ring-border" />}
              <input
                ref={promoRef}
                type="file"
                accept="image/*"
                hidden
                data-testid="promo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void setPromo(file);
                }}
              />
              <Button variant="outline" onClick={() => promoRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <Upload />} {settings.promoPhotoId ? "Changer l'image" : "Choisir une image"}
              </Button>
              {settings.promoPhotoId && <Button variant="ghost" onClick={() => setPromo(null)} disabled={uploading}>Retirer</Button>}
            </div>
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saving || !dirty}>
              {saving ? <Spinner className="text-primary-foreground" /> : <Check />} Enregistrer le style
            </Button>
            <p className="text-xs text-muted-foreground">Les photos déjà composées gardent l'ancien style : recomposez-les depuis Annonces.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="order-first overflow-hidden lg:sticky lg:top-6 lg:order-none">
        <canvas ref={canvasRef} className="aspect-square w-full bg-muted" data-testid="photo-preview" aria-label="Aperçu de la photo d'annonce" role="img" />
        <CardContent className="py-3 sm:py-3">
          <p className="text-xs text-muted-foreground">Aperçu exact du fichier publié{sample instanceof HTMLCanvasElement ? " (carte factice : scannez une carte pour voir un vrai exemplaire)" : ""}.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── Canaux ─────────────────────────

const MODES: { value: ChannelMode; label: string }[] = [
  { value: "OFF", label: "Désactivé" },
  { value: "SIMULATION", label: "Simulation" },
  { value: "LIVE", label: "Réel" },
];
const ACCESS: Record<ChannelId, { summary: string; steps: string[] }> = {
  ebay: {
    summary: "eBay demande un compte développeur (gratuit) relié à votre compte vendeur.",
    steps: [
      "Créez un compte sur le portail développeur d'eBay (developer.ebay.com) avec votre identifiant eBay.",
      "Dans « Application keys », créez un jeu de clés Sandbox, puis Production : vous obtenez un App ID (Client ID) et un Cert ID (Client Secret).",
      "Pour les clés Production, eBay demande de traiter les « notifications de suppression de compte » : abonnez-vous ou déclarez l'exemption.",
      "Dans « User tokens », créez une URL de redirection (RuName) et autorisez les droits de vente : inventaire, commandes, compte.",
      "Sur votre compte vendeur, activez les règles de vente (expédition, paiement, retours).",
      "Une fois les clés en main, dites-le dans la conversation : elles seront saisies dans un formulaire sécurisé, jamais dans le chat.",
    ],
  },
  cardtrader: {
    summary: "CardTrader fournit un jeton d'accès personnel depuis le compte vendeur.",
    steps: [
      "Connectez-vous à CardTrader, puis ouvrez les réglages du compte, rubrique API.",
      "Copiez le jeton d'accès de l'application (accès complet).",
      "Dites-le dans la conversation : le jeton sera saisi dans un formulaire sécurisé, jamais dans le chat.",
    ],
  },
};

export function Channels({ channels, onChange, compact }: { channels: ChannelState[]; onChange: (channels: ChannelState[]) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const setMode = (channel: ChannelState, mode: ChannelMode) => run(async () => {
    onChange((await api.setChannelMode(channel.id, mode)).channels);
    toast.success(`${channel.label} : ${MODES.find((m) => m.value === mode)!.label.toLowerCase()}`);
  });
  const sync = () => run(async () => {
    const r = await api.syncChannels();
    onChange((await api.channels()).channels);
    toast.success(`${r.orders} commande${r.orders > 1 ? "s" : ""} importée${r.orders > 1 ? "s" : ""}, ${r.updated} quantité${r.updated > 1 ? "s" : ""} mise${r.updated > 1 ? "s" : ""} à jour`);
    if (r.errors > 0) setError(`${r.errors} synchronisation${r.errors > 1 ? "s ont" : " a"} échoué : elles seront retentées.`);
  });

  return (
    <div className="grid gap-4">
      {!compact && <Alert variant="info">
        <strong>Simulation :</strong> tout le circuit tourne — publication, quantités, commandes, préparation — sans rien envoyer à la marketplace.
        Les commandes simulées réservent réellement le stock : annulez-les depuis Ventes après vos essais.
      </Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {channels.map((channel) => (
          <Card key={channel.id} data-testid={`channel-card-${channel.id}`}>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">{channel.label}</h2>
                <Badge variant={channel.mode === "LIVE" ? "success" : channel.mode === "SIMULATION" ? "brand" : "neutral"}>
                  {MODES.find((m) => m.value === channel.mode)!.label}
                </Badge>
              </div>
              <ChoiceGroup value={channel.mode} onValueChange={(mode) => setMode(channel, mode)} aria-label={`Mode du canal ${channel.label}`} className="grid grid-cols-3 gap-1.5">
                {MODES.map((m) => (
                  <Choice key={m.value} value={m.value} disabled={busy || (m.value === "LIVE" && !channel.liveAvailable)} className="px-2">{m.label}</Choice>
                ))}
              </ChoiceGroup>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">Annonces en cours</dt><dd className="tabular font-semibold">{channel.liveListings}</dd></div>
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">Dernière synchronisation</dt><dd className="font-medium">{channel.lastSyncedAt ? formatDateTime(channel.lastSyncedAt) : "—"}</dd></div>
              </dl>
              {!channel.liveAvailable && (
                <details className="group rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium outline-none select-none group-open:mb-2 focus-visible:underline">Passer en réel : obtenir l'accès</summary>
                  <p className="mb-2 text-muted-foreground">{ACCESS[channel.id].summary}</p>
                  <ol className="grid list-decimal gap-1.5 pl-5 text-muted-foreground">
                    {ACCESS[channel.id].steps.map((step) => <li key={step}>{step}</li>)}
                  </ol>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {!compact && <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={sync} disabled={busy}>{busy ? <Spinner /> : <RefreshCw />} Synchroniser maintenant</Button>
        <p className="text-xs text-muted-foreground">
          Les quantités annoncées suivent le stock après chaque vente ou entrée. Les commandes arrivent dans <Link href="/ventes" className="font-medium text-primary underline-offset-2 hover:underline">Ventes</Link>.
        </p>
      </div>}
    </div>
  );
}
