"use client";

import { Check, CircleSlash, MapPin, PackageCheck, Send, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, Eyebrow } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { BackLink, Code, EmptyState, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { ActionBar } from "@/components/ui/action-bar";
import type { ApiError } from "@/lib/api";
import { api } from "@/lib/api";
import { formatDateTime, formatEuros, parseEuros, variantLabel } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import { SHIPPING_LABEL, STAGE_LABEL, STAGE_VARIANT, needsTracking, salesMessage } from "@/lib/sales";
import type { OrderDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OrderSkeleton } from "@/components/skeletons";
import { useCachedState } from "@/lib/cache";

type Allocation = OrderDetail["lines"][number]["allocations"][number];
const STEPS = ["Réservée", "Prélevée", "Emballée", "Remise"];

export default function SalePage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useCachedState<OrderDetail>(`order:${id}`);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"handover" | "cancel" | null>(null);

  const load = useCallback(() => {
    api.order(id).then(setOrder).catch((e: ApiError) => (e.status === 404 || e.status === 400 ? setNotFound(true) : setError(e.message)));
  }, [id]);
  useEffect(load, [load]);

  async function run(action: () => Promise<OrderDetail>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      setOrder(await action());
      if (done) toast.success(done);
      setModal(null);
      return true;
    } catch (e) {
      setError(salesMessage(e));
      setModal(null);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const back = <BackLink href="/ventes">{t("Ventes")}</BackLink>;
  if (notFound) return <div className="grid gap-5">{back}<EmptyState icon={<CircleSlash />} title={t("Vente introuvable")} /></div>;
  if (!order) return error ? <Alert variant="destructive">{error}</Alert> : <OrderSkeleton />;

  const allocations = order.lines.flatMap((l) => l.allocations.map((a) => ({ ...a, line: l })));
  const allPicked = allocations.length > 0 && allocations.every((a) => a.status !== "RESERVED");
  const step = order.stage === "SHIPPED" ? 4 : order.stage === "PACKED" ? 3 : allPicked ? 2 : 1;
  const inPerson = order.shipment?.mode === "HAND_DELIVERY";
  const remaining = allocations.filter((a) => a.status === "RESERVED").length;

  return (
    <div className="grid gap-5">
      <PageHeader
        back={back}
        title={<>{t("Vente")} <Code>{order.externalId}</Code></>}
        meta={<>
          <Badge variant={STAGE_VARIANT[order.stage]} data-testid="order-stage">{t(STAGE_LABEL[order.stage])}</Badge>
          {order.shipment && <Badge variant="outline">{t(SHIPPING_LABEL[order.shipment.mode])}</Badge>}
          <span>{[order.buyerName, formatDateTime(order.orderedAt)].filter(Boolean).join(" · ")}</span>
        </>}
        actions={order.stage !== "SHIPPED" && order.stage !== "CANCELLED" && (
          <Button variant="destructive" size="sm" onClick={() => setModal("cancel")} disabled={busy}><X /> {t("Annuler la vente")}</Button>
        )}
      />

      {order.stage !== "CANCELLED" && (
        <ol className="grid grid-cols-4 gap-1.5" aria-label={t("Avancement")}>
          {STEPS.map((label, i) => {
            const done = i + 1 <= step;
            return (
              <li key={label} className="grid gap-1.5" aria-current={i + 1 === step ? "step" : undefined}>
                <span className={cn("h-1.5 rounded-full", done ? "bg-primary" : "bg-muted")} aria-hidden />
                <span className={cn("text-xs font-medium", done ? "text-foreground" : "text-muted-foreground")}>{t(label)}</span>
              </li>
            );
          })}
        </ol>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}
      {order.note && <Alert variant="info">{order.note}</Alert>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>{order.stage === "TO_PREPARE" ? t("À prélever") : t("Cartes")}</Eyebrow>
              {order.stage === "TO_PREPARE" && remaining > 0 && <span className="tabular text-xs text-muted-foreground">{tn(remaining, "{n} restante", "{n} restantes")}</span>}
            </div>
            {allocations.length === 0 ? (
              <ul className="grid divide-y">
                {order.lines.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium">{l.card.name}</span><span className="text-xs text-muted-foreground">{l.condition} × {l.qty}</span></span>
                    <span className="tabular font-medium">{formatEuros(l.unitPriceCents * l.qty)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="grid divide-y">
                {allocations.map((a) => (
                  <PickRow key={a.id} allocation={a} line={a.line} editable={order.stage === "TO_PREPARE"} busy={busy} onPick={(sku) => run(() => api.pickAllocation(order.id, a.id, sku))} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-3">
            <Eyebrow>{t("Résultat")}</Eyebrow>
            <dl className="tabular grid gap-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Cartes")}</dt><dd>{formatEuros(order.totals.itemsCents)}</dd></div>
              {order.totals.shippingChargedCents > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("Port facturé")}</dt><dd>{formatEuros(order.totals.shippingChargedCents)}</dd></div>}
              <div className="flex justify-between font-medium"><dt>{t("Encaissé")}</dt><dd>{formatEuros(order.totals.grossCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Coût des cartes")}</dt><dd>− {formatEuros(order.totals.costCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Affranchissement")}</dt><dd>− {formatEuros(order.totals.postageCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Fournitures")} <span className="text-xs">({inPerson ? t("sleeve, top-loader") : t("sleeve, top-loader, enveloppe")})</span></dt><dd data-testid="order-supplies">− {formatEuros(order.totals.suppliesCents)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>{order.totals.estimated ? t("Marge estimée") : t("Marge")}</dt><dd data-testid="order-margin" className={order.totals.marginCents < 0 ? "text-destructive" : undefined}>{formatEuros(order.totals.marginCents)}</dd></div>
            </dl>
            {order.totals.estimated && (
              <p className="text-xs text-muted-foreground">
                {t("Affranchissement et fournitures d'après vos")} <Link href="/reglages/envois" className="underline underline-offset-2 hover:text-foreground">{t("frais d'envoi")}</Link>{t(" ; figés à la remise.")}
              </p>
            )}
            {order.shipment?.tracking && <p className="text-xs text-muted-foreground">{t("Suivi :")} <Code>{order.shipment.tracking}</Code></p>}
            {order.shipment?.handoverConfirmedAt && <p className="text-xs text-muted-foreground">{t("Remise le {date}", { date: formatDateTime(order.shipment.handoverConfirmedAt) })}</p>}
          </CardContent>
        </Card>
      </div>

      {order.stage === "TO_PREPARE" && (
        <ActionBar message={allPicked ? t("Toutes les cartes sont prélevées : la vente peut être emballée.") : tn(remaining, "Prélevez {n} carte pour pouvoir emballer.", "Prélevez {n} cartes pour pouvoir emballer.")}>
          <Button disabled={busy || !allPicked} onClick={() => run(() => api.packOrder(order.id), t("Vente emballée"))}>
            {busy ? <Spinner className="text-primary-foreground" /> : <PackageCheck />} {t("Marquer comme emballée")}
          </Button>
        </ActionBar>
      )}
      {order.stage === "PACKED" && (
        <ActionBar message={inPerson ? t("Emballée : à remettre à l'acheteur.") : order.shipment ? t("Emballée : à déposer ({mode}).", { mode: t(SHIPPING_LABEL[order.shipment.mode]).toLowerCase() }) : t("Emballée : à déposer.")}>
          <Button disabled={busy} onClick={() => setModal("handover")}>
            <Send /> {inPerson ? t("Confirmer la remise") : t("Confirmer le dépôt")}
          </Button>
        </ActionBar>
      )}

      {modal === "handover" && order.shipment && (
        <HandoverModal order={order} busy={busy} onClose={() => setModal(null)} onSubmit={(input) => run(() => api.handOver(order.id, input), inPerson ? t("Remise confirmée") : t("Dépôt confirmé"))} />
      )}
      {modal === "cancel" && (
        <CancelModal busy={busy} onClose={() => setModal(null)} onSubmit={(reason) => run(() => api.cancelOrder(order.id, reason), t("Vente annulée, cartes remises en vente"))} />
      )}
    </div>
  );
}

function PickRow({ allocation, line, editable, busy, onPick }: {
  allocation: Allocation;
  line: OrderDetail["lines"][number];
  editable: boolean;
  busy: boolean;
  onPick: (unitSku: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const picked = allocation.status !== "RESERVED";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await onPick(code)) setCode("");
  }

  return (
    <li className="grid gap-2.5 py-3 first:pt-0" data-testid={`pick-${allocation.unitSku}`}>
      <div className="flex items-start gap-3">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", picked ? "bg-success-soft text-success" : "bg-brand-soft text-primary")} aria-hidden>
          {picked ? <Check className="size-5" strokeWidth={2.5} /> : <MapPin className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <Code className="text-base font-semibold">{allocation.locationCode}</Code>
            <Code className="text-xs text-muted-foreground">{allocation.unitSku}</Code>
          </span>
          <span className="block truncate text-sm">{line.card.name} <span className="text-muted-foreground">× {allocation.qty}</span></span>
          <span className="block truncate text-xs text-muted-foreground">
            {line.card.setId} {line.card.localNumber} · {variantLabel({ ...line.card, stamp: "", subtype: "" })} · {line.condition}
          </span>
        </span>
        {picked && <Badge variant="success">{t("Prélevée")}</Badge>}
      </div>
      {editable && !picked && (
        <form className="flex items-end gap-2" onSubmit={submit}>
          <Field label={t("Code lu sur la pochette")} className="flex-1">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("{sku} ou {number}", { sku: allocation.unitSku, number: Number(allocation.unitSku.slice(3)) })} inputMode="numeric" autoCapitalize="characters" autoCorrect="off" className="font-mono" required />
          </Field>
          <Button type="submit" variant="outline" disabled={busy || !code.trim()} aria-label={t("Prélever {sku}", { sku: allocation.unitSku })}>
            {busy ? <Spinner /> : <Check />} {t("Prélever")}
          </Button>
        </form>
      )}
    </li>
  );
}

function HandoverModal({ order, busy, onClose, onSubmit }: {
  order: OrderDetail;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { tracking?: string; postageCostCents?: number }) => void;
}) {
  const mode = order.shipment!.mode;
  const inPerson = mode === "HAND_DELIVERY";
  const [tracking, setTracking] = useState("");
  // Préremplie avec l'affranchissement habituel de ce mode (Réglages → Frais d'envoi), à corriger au besoin.
  const [postage, setPostage] = useState(eurosInput(order.totals.postageCents));
  const postageCents = parseEuros(postage);

  return (
    <Modal
      title={inPerson ? t("Confirmer la remise") : t("Confirmer le dépôt")}
      description={inPerson ? t("Les cartes ont été remises à l'acheteur : elles sortent du stock.") : t("Le pli a été déposé (poste ou point relais) : les cartes sortent du stock.")}
      onClose={onClose}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (postageCents !== null) onSubmit({ tracking: tracking.trim() || undefined, postageCostCents: inPerson ? undefined : postageCents });
        }}
      >
        {needsTracking(mode) && (
          <Field label={t("Numéro de suivi")}>
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} autoCapitalize="characters" autoCorrect="off" required autoFocus className="font-mono" />
          </Field>
        )}
        {!inPerson && (
          <Field label={t("Affranchissement payé (€)")} hint={t("Déduit de la marge, avec les fournitures.")}>
            <Input inputMode="decimal" value={postage} onChange={(e) => setPostage(e.target.value)} onFocus={(e) => e.target.select()} aria-invalid={postageCents === null} className="tabular" />
          </Field>
        )}
        <Button type="submit" size="lg" disabled={busy || postageCents === null || (needsTracking(mode) && !tracking.trim())}>
          {inPerson ? t("Confirmer la remise") : t("Confirmer le dépôt")}
        </Button>
      </form>
    </Modal>
  );
}

function CancelModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("Annuler la vente")} description={t("Les réservations sont libérées : les cartes redeviennent disponibles à la vente.")} onClose={onClose}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); onSubmit(reason.trim()); }}>
        <Field label={t("Motif (obligatoire)")}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t("Ex. acheteur désisté")} required autoFocus className="min-h-20" />
        </Field>
        <Button type="submit" size="lg" variant="destructive" disabled={busy || !reason.trim()}>{t("Annuler la vente")}</Button>
      </form>
    </Modal>
  );
}
