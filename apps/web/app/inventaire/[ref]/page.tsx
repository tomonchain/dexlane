"use client";

import {
  ArrowDownToLine, ArrowLeft, ArrowLeftRight, BadgeCheck, CircleSlash, ClipboardPen, Layers, MoveRight, PackageCheck, PackageMinus,
  ShieldAlert, Truck, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { LocationPicker } from "@/components/location-picker";
import { Stepper } from "@/components/stepper";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/input";
import { Code, EmptyState, Loading } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { ApiError, api, createKeyring } from "@/lib/api";
import { LIFECYCLE, formatDateTime, formatEuros, movementLabel, positionSubtitle, positionTitle } from "@/lib/format";
import { CATEGORY_LABEL, CATEGORY_VARIANT, age, quoteLabel, reasonLabel, type Category } from "@/lib/pricing";
import type { Movement, PositionDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND: Record<string, string> = { UNIQUE: "Exemplaire unique", FUNGIBLE: "Interchangeable", BULK: "Vrac" };
const PHOTO_KIND: Record<string, string> = { SCAN_FRONT: "Recto", SCAN_BACK: "Verso", LISTING: "Annonce" };
const ERRORS: Record<string, string> = {
  ADJUST_BELOW_COMMITTED: "Des cartes de cette position sont réservées pour une commande : traitez d'abord la commande concernée.",
  LOCATION_NOT_FOUND: "Cet emplacement n'existe pas.",
  NOT_DRAFT: "Cette position ne peut pas être validée.",
};
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);

const MOVEMENT_ICONS: Record<string, LucideIcon> = {
  RECEIVE: ArrowDownToLine, MOVE: ArrowLeftRight, ALLOCATE: PackageCheck, RELEASE: PackageMinus, PICK: PackageCheck,
  SHIP_OUT: Truck, ADJUST: ClipboardPen, BULK_EXTRACT: Layers, QUARANTINE: ShieldAlert, LOST: CircleSlash, DISPOSED: CircleSlash,
};

function Metric({ label, value, testId, muted }: { label: string; value: React.ReactNode; testId?: string; muted?: boolean }) {
  return (
    <div className="grid gap-1.5 bg-card px-4 py-3.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("tabular text-xl leading-none font-semibold tracking-tight", muted && "text-muted-foreground")} data-testid={testId}>{value}</dd>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function MovementRow({ m }: { m: Movement }) {
  const Icon = MOVEMENT_ICONS[m.movementType] ?? MoveRight;
  const showDelta = m.qtyDelta !== 0 && m.bucket === "on_hand";
  return (
    <li className="flex gap-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">
          <strong className="font-medium">{movementLabel(m)}</strong>
          {m.movementType === "MOVE" && <Code className="text-muted-foreground"> {m.fromLocationCode} → {m.toLocationCode}</Code>}
          {m.reason && <span> — {m.reason}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{formatDateTime(m.createdAt)} · {m.actor}</span>
      </span>
      {showDelta && (
        <span className={cn("tabular self-center text-sm font-semibold", m.qtyDelta > 0 ? "text-success" : "text-destructive")}>
          {m.qtyDelta > 0 ? "+" : "−"}{Math.abs(m.qtyDelta)}
        </span>
      )}
    </li>
  );
}

export default function PositionPage() {
  const { ref } = useParams<{ ref: string }>();
  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [modal, setModal] = useState<"move" | "adjust" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.position(decodeURIComponent(ref))
      .then((p) => {
        setPosition(p);
        setError(null);
      })
      .catch((e: ApiError) => (e.status === 404 ? setNotFound(true) : setError(e.message)));
  }, [ref]);
  useEffect(load, [load]);

  const back = (
    <Button variant="ghost" size="sm" asChild className="-ml-2 justify-self-start text-muted-foreground">
      <Link href="/inventaire"><ArrowLeft /> Inventaire</Link>
    </Button>
  );

  if (notFound) {
    return (
      <div className="grid gap-5">
        {back}
        <EmptyState icon={<CircleSlash />} title="Position introuvable">
          Aucune position ne porte le code <Code>{decodeURIComponent(ref)}</Code>.
        </EmptyState>
      </div>
    );
  }
  if (!position) return error ? <Alert variant="destructive">{error}</Alert> : <Loading />;

  const p = position;
  async function run(action: () => Promise<PositionDetail>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast.success(done);
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setModal(null);
      setBusy(false);
    }
  }

  const sellable = p.lifecycle === "ACTIVE" ? p.availableToSell : 0;

  return (
    <div className="grid gap-5">
      {back}

      <div className="flex items-start gap-4">
        {p.card ? <CardThumb imageUrl={p.card.imageUrl} size="lg" /> : (
          <span className="flex aspect-[63/88] w-24 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border" aria-hidden><Layers className="size-6" /></span>
        )}
        <div className="grid min-w-0 gap-2">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{positionTitle(p)}</h1>
          <p className="text-sm text-muted-foreground">{positionSubtitle(p)}</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={p.lifecycle === "ACTIVE" ? "success" : p.lifecycle === "DRAFT" ? "warning" : "outline"}>{LIFECYCLE[p.lifecycle]}</Badge>
            <Badge variant="neutral">{KIND[p.kind]}</Badge>
            {p.card?.variantIncomplete && <Badge variant="warning">Variante à confirmer</Badge>}
          </div>
        </div>
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}
      {p.lifecycle === "DRAFT" && (
        <Alert variant="warning">Brouillon : cette position n'est pas vendable tant qu'elle n'est pas validée.</Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {p.lifecycle === "DRAFT" && (
          <Button disabled={busy} onClick={() => run(() => api.activate(p.id), "Position validée")}><BadgeCheck /> Valider (rendre vendable)</Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => setModal("move")}><ArrowLeftRight /> Déplacer</Button>
        <Button variant="outline" disabled={busy} onClick={() => setModal("adjust")}><ClipboardPen /> Corriger le stock</Button>
        {p.kind === "BULK" && p.availableToSell > 0 && (
          <Button variant="outline" asChild><Link href={`/ajouter?vrac=${p.id}`}><Layers /> Extraire une carte</Link></Button>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-5">
          <Card className="overflow-hidden">
            <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              <Metric label="En stock" value={p.onHand} testId="on-hand" />
              <Metric label="Vendable" value={sellable} testId="sellable" />
              <Metric label="Réservé" value={p.reserved} muted={p.reserved === 0} />
              <Metric label="Coût unitaire" value={formatEuros(p.unitCostCents)} />
            </dl>
          </Card>

          <Card>
            <CardContent className="py-2 sm:py-2">
              <dl className="divide-y">
                <Fact label="Position"><Code>{p.unitSku}</Code></Fact>
                <Fact label="Emplacement"><Code>{p.locationCode}</Code></Fact>
                {p.offer && <Fact label="Offre"><Code className="whitespace-normal">{p.offer.offerSku}</Code></Fact>}
                {p.offer && <Fact label="État">{p.offer.condition}</Fact>}
                {p.inspection > 0 && <Fact label="En inspection">{p.inspection}</Fact>}
                {p.quarantine > 0 && <Fact label="En quarantaine">{p.quarantine}</Fact>}
                <Fact label="Entrée le">{formatDateTime(p.createdAt)}</Fact>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5">
        {p.photos.some((photo) => photo.kind !== "LISTING") && (
          <Card data-testid="position-photos">
            <CardContent className="grid gap-3">
              <Eyebrow>Photos de l'exemplaire</Eyebrow>
              <div className="flex flex-wrap gap-3">
                {p.photos.filter((photo) => photo.kind !== "LISTING").map((photo) => (
                  <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="grid gap-1 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30">
                    <img className="aspect-[63/88] w-28 rounded-lg bg-muted object-cover ring-1 ring-border" src={photo.url} alt={PHOTO_KIND[photo.kind]} loading="lazy" />
                    <span className="text-center text-xs text-muted-foreground">{PHOTO_KIND[photo.kind]}</span>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {p.offer && (
          <Card data-testid="offer-pricing">
            <CardContent className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <Eyebrow>Prix de l'offre</Eyebrow>
                <Badge variant={CATEGORY_VARIANT[p.offer.category as Category]}>{CATEGORY_LABEL[p.offer.category as Category]}</Badge>
              </div>
              <dl className="tabular grid grid-cols-3 gap-3 text-sm">
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">Prix cible</dt><dd className="text-lg font-semibold">{p.offer.targetPriceCents === null ? "—" : formatEuros(p.offer.targetPriceCents)}</dd></div>
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">Plancher</dt><dd className="text-lg font-semibold text-muted-foreground">{p.offer.floorPriceCents === null ? "—" : formatEuros(p.offer.floorPriceCents)}</dd></div>
                <div className="grid gap-0.5"><dt className="text-xs text-muted-foreground">Suggéré</dt><dd className="text-lg font-semibold text-muted-foreground">{p.offer.suggestedPriceCents === null ? "—" : formatEuros(p.offer.suggestedPriceCents)}</dd></div>
              </dl>
              {p.offer.reference && (
                <p className="text-xs text-muted-foreground">
                  Référence : {quoteLabel(p.offer.reference.quoteType)} Cardmarket {formatEuros(p.offer.reference.amountCents)}, relevée {age(p.offer.reference.observedAt)}.
                </p>
              )}
              {p.offer.priceReasons.length > 0 && (
                <Alert variant="warning"><ul className="grid gap-0.5">{p.offer.priceReasons.map((r) => <li key={r}>{reasonLabel(r)}</li>)}</ul></Alert>
              )}
              <Button variant="link" size="sm" asChild className="justify-self-start">
                <Link href={`/prix?q=${encodeURIComponent(p.offer.offerSku)}`}>Décider du prix</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="grid gap-1">
            <Eyebrow>Historique</Eyebrow>
            <ul className="divide-y">
              {p.movements.map((m) => <MovementRow key={m.id} m={m} />)}
            </ul>
          </CardContent>
        </Card>
        </div>
      </div>

      {modal === "move" && (
        <LocationPicker value={p.locationCode} onClose={() => setModal(null)} onPick={(code) => run(() => api.move(p.id, code), `Déplacée en ${code}`)} />
      )}
      {modal === "adjust" && (
        <AdjustModal position={p} busy={busy} onClose={() => setModal(null)} onSubmit={(count, reason, key) => run(() => api.adjust(p.id, count, reason, key), "Stock corrigé")} />
      )}
    </div>
  );
}

function AdjustModal({ position, busy, onClose, onSubmit }: {
  position: PositionDetail;
  busy: boolean;
  onClose: () => void;
  onSubmit: (count: number, reason: string, key: string) => void;
}) {
  const [count, setCount] = useState(position.onHand);
  const [reason, setReason] = useState("");
  const keyring = useRef(createKeyring());
  const committed = position.reserved + position.inspection + position.quarantine;
  const delta = count - position.onHand;

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(count, reason.trim(), keyring.current.keyFor({ id: position.id, count, reason: reason.trim() }));
  }

  return (
    <Modal
      title="Corriger le stock"
      description={`Saisissez la quantité réellement comptée en ${position.locationCode}. Le système enregistre l'écart (${position.onHand} actuellement).`}
      onClose={onClose}
    >
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-1.5">
          <span className="text-[13px] leading-none font-medium text-foreground/80">Quantité comptée</span>
          <Stepper value={count} onChange={setCount} min={0} max={position.kind === "UNIQUE" ? 1 : 1_000_000} label="Quantité comptée" />
        </div>
        {count < committed && (
          <Alert variant="warning">{committed} carte{committed > 1 ? "s sont engagées" : " est engagée"} (commande, inspection ou quarantaine) : la correction sera refusée.</Alert>
        )}
        <Field label="Motif (obligatoire)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. comptage du 17/11, carte abîmée retirée" required />
        </Field>
        <Button type="submit" size="lg" disabled={busy || delta === 0 || !reason.trim()}>
          {delta === 0 ? "Aucun écart" : `Enregistrer l'écart (${delta > 0 ? "+" : "−"}${Math.abs(delta)})`}
        </Button>
      </form>
    </Modal>
  );
}
