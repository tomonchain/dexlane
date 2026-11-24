"use client";

import { Check, Copy, ExternalLink, MessageSquareHeart, Pencil, RefreshCw, Truck, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Code, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CARRIERS, CARRIER_LABEL, DELIVERY_LABEL, DELIVERY_VARIANT, detectCarrier, reviewMessage, trackingUrl } from "@/lib/sales";
import type { Carrier, OrderDetail } from "@/lib/types";

/**
 * Après la remise : où en est le colis (transporteur, numéro, dernier événement, livraison), et la demande d'avis à
 * l'acheteur, due 24 h après la livraison, avec un message prêt à copier.
 */
export function DeliveryCard({ order, onChange }: { order: OrderDetail; onChange: (order: OrderDetail) => void }) {
  const shipment = order.shipment!;
  const delivery = order.delivery;
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(shipment.tracking ?? "");
  const [carrier, setCarrier] = useState<Carrier | "">(shipment.carrier ?? "");
  const [connected, setConnected] = useState<Record<string, boolean> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inPerson = shipment.mode === "HAND_DELIVERY";

  useEffect(() => {
    api.trackingStatus().then((r) => setConnected(r.carriers)).catch(() => setConnected({}));
    api.appSettings().then((s) => setMessage(reviewMessage(s.reviewMessage ?? "", order.buyerName, s.seller.name))).catch(() => setMessage(reviewMessage("", order.buyerName, "")));
  }, [order.buyerName]);

  async function run(key: string, action: () => Promise<OrderDetail | unknown>, done?: string) {
    setBusy(key);
    try {
      const result = await action();
      if (result && typeof result === "object" && "id" in result) onChange(result as OrderDetail);
      else onChange(await api.order(order.id));
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const url = shipment.tracking ? trackingUrl(shipment.carrier, shipment.tracking, order.addressLines) : null;
  const automatic = shipment.carrier && shipment.carrier !== "OTHER" && connected?.[shipment.carrier];
  const delivered = shipment.status === "DELIVERED";
  const reviewDue = delivery?.reviewDue ?? false;
  const deliveredAt = shipment.deliveredAt ? new Date(shipment.deliveredAt) : null;
  const reviewFrom = deliveredAt ? new Date(deliveredAt.getTime() + 24 * 3600 * 1000) : null;

  return (
    <Card data-testid="delivery-card">
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow className="flex items-center gap-1.5"><Truck className="size-3.5" aria-hidden /> {inPerson ? t("Remise") : t("Livraison")}</Eyebrow>
          <Badge variant={DELIVERY_VARIANT[shipment.status] ?? "outline"} data-testid="delivery-status">{t(DELIVERY_LABEL[shipment.status] ?? shipment.status)}</Badge>
        </div>

        {!inPerson && (
          editing ? (
            <form className="grid gap-3" onSubmit={(e) => {
              e.preventDefault();
              void run("tracking", () => api.updateTracking(order.id, { tracking: tracking.trim() || null, carrier: carrier || null }), t("Suivi mis à jour")).then((ok) => ok && setEditing(false));
            }}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <Field label={t("Numéro de suivi")}>
                  <Input value={tracking} onChange={(e) => { setTracking(e.target.value); const d = detectCarrier(e.target.value); if (d) setCarrier(d); }} className="font-mono" autoCapitalize="characters" />
                </Field>
                <Field label={t("Transporteur")}>
                  <Select value={carrier} onChange={(e) => setCarrier(e.target.value as Carrier | "")}>
                    <option value="">{t("Inconnu")}</option>
                    {CARRIERS.map((c) => <option key={c} value={c}>{t(CARRIER_LABEL[c])}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy === "tracking"}>{busy === "tracking" ? <Spinner /> : <Check />} {t("Enregistrer")}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("Annuler")}</Button>
              </div>
            </form>
          ) : (
            <div className="grid gap-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {shipment.tracking ? <Code className="font-semibold" data-testid="delivery-tracking">{shipment.tracking}</Code> : <span className="text-muted-foreground">{t("Sans numéro de suivi")}</span>}
                {shipment.carrier && <span className="text-muted-foreground">· {t(CARRIER_LABEL[shipment.carrier])}</span>}
                <Button size="icon-sm" variant="ghost" aria-label={t("Modifier le suivi")} onClick={() => setEditing(true)}><Pencil /></Button>
              </div>
              {shipment.trackingEvent && (
                <p className="text-[13px]">
                  {shipment.trackingEvent}
                  {shipment.trackingEventAt && <span className="text-muted-foreground"> · {formatDateTime(shipment.trackingEventAt)}</span>}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {automatic
                  ? shipment.trackingCheckedAt ? t("Suivi automatique, vérifié le {date}.", { date: formatDateTime(shipment.trackingCheckedAt) }) : t("Suivi automatique : vérifié chaque matin.")
                  : shipment.carrier && shipment.carrier !== "OTHER" ? t("Suivi automatique non relié pour ce transporteur : notez la livraison à la main.") : t("Notez la livraison à la main une fois le colis reçu.")}
              </p>
            </div>
          )
        )}

        {shipment.handoverConfirmedAt && (
          <p className="text-xs text-muted-foreground">
            {inPerson ? t("Remise le {date}", { date: formatDateTime(shipment.handoverConfirmedAt) }) : t("Déposée le {date}", { date: formatDateTime(shipment.handoverConfirmedAt) })}
            {deliveredAt && !inPerson && ` · ${t("livrée le {date}", { date: formatDateTime(deliveredAt.toISOString()) })}`}
          </p>
        )}

        {!delivered && !editing && (
          <div className="flex flex-wrap gap-2">
            {url && <Button asChild size="sm" variant="outline"><a href={url} target="_blank" rel="noreferrer"><ExternalLink /> {t("Suivre le colis")}</a></Button>}
            {automatic && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("refresh", () => api.refreshTracking(), t("Suivi actualisé"))}>{busy === "refresh" ? <Spinner /> : <RefreshCw />} {t("Actualiser")}</Button>}
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("delivered", () => api.markDelivered(order.id), t("Livraison notée"))} data-testid="mark-delivered">
              {busy === "delivered" ? <Spinner /> : <Check />} {t("Marquer comme livrée")}
            </Button>
          </div>
        )}
        {delivered && url && !inPerson && <Button asChild size="sm" variant="ghost" className="justify-self-start"><a href={url} target="_blank" rel="noreferrer"><ExternalLink /> {t("Voir le suivi")}</a></Button>}

        {delivered && (
          <section className="grid gap-3 border-t pt-4" aria-label={t("Demande d'avis")} data-testid="review-panel">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareHeart className="size-4 text-brand" aria-hidden /> {t("Demande d'avis")}</h3>
            {shipment.reviewRequestedAt ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="success">{t("Demandé le {date}", { date: formatDateTime(shipment.reviewRequestedAt) })}</Badge>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("review", () => api.markReviewRequested(order.id, false))}><Undo2 /> {t("Annuler")}</Button>
              </div>
            ) : (
              <>
                {reviewDue
                  ? <Alert variant="info">{t("Livrée depuis plus de 24 h : c'est le bon moment pour demander un avis.")}</Alert>
                  : reviewFrom && <p className="text-xs text-muted-foreground">{t("À demander à partir du {date}, 24 h après la livraison.", { date: formatDateTime(reviewFrom.toISOString()) })}</p>}
                {message !== null && (
                  <Field label={t("Message à envoyer")} hint={order.channel === "direct" ? t("Par message ou e-mail à l'acheteur.") : t("Par la messagerie de {channel}.", { channel: order.channel === "ebay" ? "eBay" : order.channel === "cardtrader" ? "CardTrader" : order.channel })}>
                    <Textarea value={message} onChange={(e) => setMessage(e.target.value)} className="min-h-32 text-sm" data-testid="review-message" />
                  </Field>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(message ?? "").then(() => toast.success(t("Message copié"))); }}><Copy /> {t("Copier le message")}</Button>
                  <Button size="sm" disabled={busy !== null} onClick={() => run("review", () => api.markReviewRequested(order.id, true), t("Demande d'avis notée"))} data-testid="review-requested">
                    {busy === "review" ? <Spinner /> : <Check />} {t("Avis demandé")}
                  </Button>
                </div>
              </>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
