"use client";

import { Check, Copy, ImagePlus, Megaphone, RefreshCw, Search, ShoppingCart, Upload, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TITLE_MAX, VARIABLES, buildListingText, type ListingSubject } from "@dexlane/listings/template";
import { CardThumb } from "@/components/card-chooser";
import { OfferPhotos } from "@/components/offer-photos";
import { SaveBar } from "@/components/ui/action-bar";
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
import { t, tn } from "@/lib/i18n";
import { prepareImage } from "@/lib/image";
import type { ChannelId, ChannelMode, ChannelState, ListingBlocker, ListingOffer, ListingSettings, ListingState, Photo, PhotoStyle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { composeMissingVisuals } from "@/lib/visuals";

const PAGE_SIZE = 20;
const ERRORS: Record<string, string> = {
  PHOTO_STORAGE_UNAVAILABLE: "Le stockage des photos n'est pas configuré.",
  CHANNEL_DISABLED: "Ce canal est désactivé : activez-le dans Réglages → Canaux de vente.",
  CHANNEL_NOT_CONFIGURED: "Le connecteur réel de ce canal n'est pas encore configuré. Utilisez la simulation en attendant.",
  LISTING_NOT_READY: "Cette offre n'est pas prête : il lui manque un prix, une photo ou une variante confirmée.",
  OFFER_NOT_SELLABLE: "Cette offre n'a plus de stock vendable.",
  LISTING_NOT_FOUND: "Cette annonce n'existe plus.",
};
const message = (e: unknown) => {
  if (!(e instanceof ApiError)) return (e as Error).message;
  const known = ERRORS[e.code];
  return known ? t(known) : e.message;
};
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

/** Applique le style enregistré aux photos d'annonce déjà composées de tout le stock. */
function RecomposeAll({ disabled }: { disabled: boolean }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  async function run() {
    setProgress({ done: 0, total: 0 });
    try {
      const ids: string[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await api.stock({ status: "ALL", limit: 200, offset });
        ids.push(...page.items.map((r) => r.offerId));
        if (page.items.length < 200) break;
      }
      const composed = await composeMissingVisuals(ids, (done, total) => setProgress({ done, total }), { force: true, all: true });
      toast.success(composed > 0 ? tn(composed, "{n} photo d'annonce recomposée", "{n} photos d'annonce recomposées") : t("Aucune photo à recomposer"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setProgress(null);
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {t("Les photos déjà composées gardent l'ancien style.")}
      <Button variant="outline" size="sm" onClick={run} disabled={disabled || progress !== null}>
        {progress ? <><Spinner /> {progress.total ? `${progress.done} / ${progress.total}` : "…"}</> : <><Wand2 /> {t("Tout recomposer")}</>}
      </Button>
    </span>
  );
}

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
      toast.success(t("Modèle enregistré"));
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
          <Field label={t("Modèle de titre")} hint={t("{max} caractères au plus une fois rempli : au-delà, le titre est coupé au dernier mot.", { max: TITLE_MAX })}>
            <Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} onFocus={() => (focused.current = "title")} spellCheck={false} />
          </Field>
          <Field label={t("Modèle de description")} hint={t("Une ligne dont les variables sont vides (rareté inconnue, par exemple) est retirée de l'annonce.")}>
            <Textarea ref={descriptionRef} value={description} onChange={(e) => setDescription(e.target.value)} onFocus={() => (focused.current = "description")} rows={11} spellCheck={false} />
          </Field>
          <div className="grid gap-2">
            <Eyebrow>{t("Variables — cliquez pour insérer")}</Eyebrow>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => insert(v.key)}
                  title={t("{label} — ex. {example}", { label: t(v.label), example: v.example })}
                  className="rounded-md border bg-card px-2 py-1 font-mono text-xs shadow-xs transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30"
                >
                  {`{${v.key}}`}
                </button>
              ))}
            </div>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          {dirty && (
            <SaveBar message={t("Modèle d'annonce modifié")} saveLabel={t("Enregistrer le modèle")} saving={saving} onSave={save}
              onDiscard={() => { setTitle(settings.titleTemplate); setDescription(settings.descriptionTemplate); }} />
          )}
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-6">
        <CardContent className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>{t("Aperçu sur une carte d'exemple")}</Eyebrow>
            <span className={cn("tabular text-xs", preview.warnings.includes("TITLE_TOO_LONG") ? "font-medium text-warning" : "text-muted-foreground")}>
              {preview.title.length}/{TITLE_MAX}
            </span>
          </div>
          <p className="text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]" data-testid="template-preview-title">{preview.title}</p>
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap" data-testid="template-preview-description">{preview.description}</p>
          {preview.warnings.includes("TITLE_TOO_LONG") && <Alert variant="warning">{t("Titre trop long pour cette carte : il a été coupé à {max} caractères.", { max: TITLE_MAX })}</Alert>}
          {preview.warnings.includes("UNKNOWN_VARIABLE") && <Alert variant="warning">{t("Une variable entre accolades n'existe pas : elle resterait telle quelle dans l'annonce.")}</Alert>}
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
      toast.success(t("Style des photos enregistré"));
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
      toast.success(file ? t("Image de fin d'annonce enregistrée") : t("Image de fin d'annonce retirée"));
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
            <Eyebrow>{t("Fond")}</Eyebrow>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8" role="radiogroup" aria-label={t("Fond des photos")}>
              {BACKGROUND_PRESETS.map((preset) => {
                const selected = sameBackground(preset.background, b);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t(preset.name)}
                    title={t(preset.name)}
                    onClick={() => patch({ background: preset.background })}
                    className={cn(
                      "grid gap-1 rounded-lg p-1 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/30",
                      selected && "bg-brand-soft text-primary",
                    )}
                  >
                    <span className={cn("aspect-square rounded-md ring-1 ring-border", selected && "ring-2 ring-primary")} style={{ background: backgroundCss(preset.background) }} />
                    {t(preset.name)}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t("Type de fond")}>
                <Select
                  value={b.type}
                  onChange={(e) => {
                    const type = e.target.value;
                    if (type === "color") patch({ background: { type: "color", color: b.type === "gradient" ? b.from : b.type === "color" ? b.color : "#0f172a" } });
                    else if (type === "gradient") patch({ background: { type: "gradient", from: b.type === "color" ? b.color : "#1e293b", to: "#0f172a", angle: 135 } });
                    else fileRef.current?.click();
                  }}
                >
                  <option value="color">{t("Couleur unie")}</option>
                  <option value="gradient">{t("Dégradé")}</option>
                  <option value="image">{t("Image")}</option>
                </Select>
              </Field>
              {b.type === "color" && (
                <Field label={t("Couleur")}><Input type="color" value={b.color} onChange={(e) => patch({ background: { ...b, color: e.target.value } })} className="p-1" /></Field>
              )}
              {b.type === "gradient" && (
                <>
                  <Field label={t("Couleur de départ")}><Input type="color" value={b.from} onChange={(e) => patch({ background: { ...b, from: e.target.value } })} className="p-1" /></Field>
                  <Field label={t("Couleur d'arrivée")}><Input type="color" value={b.to} onChange={(e) => patch({ background: { ...b, to: e.target.value } })} className="p-1" /></Field>
                  <Field label={t("Angle : {angle}°", { angle: b.angle })}><input type="range" min={0} max={360} step={15} value={b.angle} onChange={(e) => patch({ background: { ...b, angle: Number(e.target.value) } })} className={cn(range, "mt-3.5")} /></Field>
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
                  {uploading ? <Spinner /> : b.type === "image" ? <ImagePlus /> : <Upload />} {b.type === "image" ? t("Changer l'image") : t("Votre image")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("Votre propre fond (tapis de jeu, bois, tissu) : une photo carrée d'au moins 1600 px rend le mieux.")}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Marge autour de la carte : {value} %", { value: style.marginPercent })}>
              <input type="range" min={0} max={25} step={1} value={style.marginPercent} onChange={(e) => patch({ marginPercent: Number(e.target.value) })} className={cn(range, "mt-2")} />
            </Field>
            <Field label={t("Rognage du bord du scan : {value} %", { value: style.trimPercent })} hint={t("Retire le liseré laissé par le scanner.")}>
              <input type="range" min={0} max={8} step={0.5} value={style.trimPercent} onChange={(e) => patch({ trimPercent: Number(e.target.value) })} className={cn(range, "mt-2")} />
            </Field>
            <Field label={t("Texte en bas de l'image")} hint={t("Pseudo de vendeur, par exemple. Facultatif.")}>
              <Input value={style.caption} maxLength={60} onChange={(e) => patch({ caption: e.target.value })} />
            </Field>
            <Field label={t("Taille de l'image")}>
              <Select value={style.size} onChange={(e) => patch({ size: Number(e.target.value) })}>
                <option value={1200}>1200 × 1200 px</option>
                <option value={1600}>{t("1600 × 1600 px (conseillé)")}</option>
                <option value={2000}>2000 × 2000 px</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 sm:gap-6">
            <SwitchRow label={t("Coins arrondis")} description={t("Masque les coins du scan au format de la carte.")} checked={style.roundCorners} onCheckedChange={(roundCorners) => patch({ roundCorners })} />
            <SwitchRow label={t("Ombre portée")} description={t("Détache la carte du fond.")} checked={style.shadow} onCheckedChange={(shadow) => patch({ shadow })} />
          </div>

          <div className="border-t pt-4">
            <SwitchRow
              label={t("Composer le visuel automatiquement")}
              description={t("Dès qu'une photo arrive (lot entré en stock, photo ajoutée) et avant chaque mise en ligne. Désactivez-le pour publier vos photos telles quelles.")}
              checked={settings.autoCompose}
              disabled={uploading}
              onCheckedChange={async (autoCompose) => {
                try {
                  onSaved(await api.saveListingSettings({ ...settings, autoCompose }));
                  toast.success(autoCompose ? t("Composition automatique activée") : t("Composition automatique désactivée"));
                } catch (e) {
                  setError(message(e));
                }
              }}
            />
          </div>
          <div className="grid gap-2 border-t pt-5" data-testid="promo">
            <Eyebrow>{t("Image de fin d'annonce")}</Eyebrow>
            <p className="text-sm text-muted-foreground">{t("Ajoutée en dernière photo de chaque annonce : « On rachète vos cartes », vos conditions d'envoi, votre logo…")}</p>
            <div className="flex flex-wrap items-center gap-3">
              {settings.promoPhotoId && <img src={api.photoContentUrl(settings.promoPhotoId)} alt={t("Image de fin d'annonce")} className="size-20 rounded-md bg-muted object-cover ring-1 ring-border" />}
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
                {uploading ? <Spinner /> : <Upload />} {settings.promoPhotoId ? t("Changer l'image") : t("Choisir une image")}
              </Button>
              {settings.promoPhotoId && <Button variant="ghost" onClick={() => setPromo(null)} disabled={uploading}>{t("Retirer")}</Button>}
            </div>
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}
          <RecomposeAll disabled={dirty || saving} />
          {dirty && <SaveBar message={t("Style des photos modifié")} saveLabel={t("Enregistrer le style")} saving={saving} onSave={save} onDiscard={() => setStyle(settings.photo)} />}
        </CardContent>
      </Card>

      <Card className="order-first overflow-hidden lg:sticky lg:top-6 lg:order-none">
        <canvas ref={canvasRef} className="aspect-square w-full bg-muted" data-testid="photo-preview" aria-label={t("Aperçu de la photo d'annonce")} role="img" />
        <CardContent className="py-3 sm:py-3">
          <p className="text-xs text-muted-foreground">{sample instanceof HTMLCanvasElement ? t("Aperçu exact du fichier publié (carte factice : scannez une carte pour voir un vrai exemplaire).") : t("Aperçu exact du fichier publié.")}</p>
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
    toast.success(t("{channel} : {mode}", { channel: channel.label, mode: t(MODES.find((m) => m.value === mode)!.label).toLowerCase() }));
  });
  const sync = () => run(async () => {
    const r = await api.syncChannels();
    onChange((await api.channels()).channels);
    toast.success(`${tn(r.orders, "{n} commande importée", "{n} commandes importées")}, ${tn(r.updated, "{n} quantité mise à jour", "{n} quantités mises à jour")}`);
    if (r.errors > 0) setError(tn(r.errors, "{n} synchronisation a échoué : elles seront retentées.", "{n} synchronisations ont échoué : elles seront retentées."));
  });

  return (
    <div className="grid gap-4">
      {!compact && <Alert variant="info">
        <strong>{t("Simulation :")}</strong> {t("tout le circuit tourne — publication, quantités, commandes, préparation — sans rien envoyer à la marketplace.")}
        {" "}{t("Les commandes simulées réservent réellement le stock : annulez-les depuis Ventes après vos essais.")}
      </Alert>}
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {channels.map((channel) => (
          <Card key={channel.id} data-testid={`channel-card-${channel.id}`}>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">{channel.label}</h2>
                <Badge variant={channel.mode === "LIVE" ? "success" : channel.mode === "SIMULATION" ? "brand" : "neutral"}>
                  {t(MODES.find((m) => m.value === channel.mode)!.label)}
                </Badge>
              </div>
              <ChoiceGroup value={channel.mode} onValueChange={(mode) => setMode(channel, mode)} aria-label={t("Mode du canal {channel}", { channel: channel.label })} className="grid grid-cols-3 gap-1.5">
                {MODES.map((m) => (
                  <Choice key={m.value} value={m.value} disabled={busy || (m.value === "LIVE" && !channel.liveAvailable)} className="px-2">{t(m.label)}</Choice>
                ))}
              </ChoiceGroup>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("Annonces en cours")}</dt><dd className="tabular font-semibold">{channel.liveListings}</dd></div>
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{t("Dernière synchronisation")}</dt><dd className="font-medium">{channel.lastSyncedAt ? formatDateTime(channel.lastSyncedAt) : "—"}</dd></div>
              </dl>
              {!channel.liveAvailable && (
                <details className="group rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium outline-none select-none group-open:mb-2 focus-visible:underline">{t("Passer en réel : obtenir l'accès")}</summary>
                  <p className="mb-2 text-muted-foreground">{t(ACCESS[channel.id].summary)}</p>
                  <ol className="grid list-decimal gap-1.5 pl-5 text-muted-foreground">
                    {ACCESS[channel.id].steps.map((step) => <li key={step}>{t(step)}</li>)}
                  </ol>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {!compact && <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={sync} disabled={busy}>{busy ? <Spinner /> : <RefreshCw />} {t("Synchroniser maintenant")}</Button>
        <p className="text-xs text-muted-foreground">
          {t("Les quantités annoncées suivent le stock après chaque vente ou entrée.")} {t("Les commandes arrivent dans")} <Link href="/ventes" className="font-medium text-primary underline-offset-2 hover:underline">{t("Ventes")}</Link>.
        </p>
      </div>}
    </div>
  );
}
