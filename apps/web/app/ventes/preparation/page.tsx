"use client";

import { Check, Printer } from "lucide-react";
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { BackLink, EmptyState, PageHeader } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { dateFormat, formatEuros, variantLabel } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { SHIPPING_LABEL } from "@/lib/sales";
import type { OrderDetail, Seller, ShippingRun, SlipPaper } from "@/lib/types";
import { PreparationSkeleton } from "@/components/skeletons";

/** Papier : largeur du document à l'écran et à l'impression, et règle de page envoyée à l'imprimante. */
const PAPERS: Record<SlipPaper, { label: string; width: string; page: string }> = {
  // Rouleau : la longueur de page est celle du pilote de l'imprimante, qui coupe à chaque saut de page.
  ROLL_80: { label: "Rouleau thermique 80 mm", width: "72mm", page: "margin: 0" },
  ROLL_58: { label: "Rouleau thermique 58 mm", width: "48mm", page: "margin: 0" },
  LABEL_100X150: { label: "Étiquette 100 × 150 mm", width: "92mm", page: "size: 100mm 150mm; margin: 4mm" },
  A4: { label: "Feuille A4", width: "180mm", page: "size: A4; margin: 15mm" },
};
const CHANNEL_LABEL: Record<string, string> = { direct: "Vente directe", ebay: "eBay", cardtrader: "CardTrader" };
const day = () => dateFormat({ dateStyle: "long", timeZone: "Europe/Paris" });

const cardLine = (line: OrderDetail["lines"][number]) =>
  [line.card.name, `${line.card.setId.toUpperCase()} ${line.card.localNumber}`, variantLabel({ ...line.card, stamp: "", subtype: "" }), line.card.language.toUpperCase(), line.condition]
    .filter(Boolean).join(" · ");

/** Une feuille du document : une page à l'impression (le rouleau est coupé après chacune). */
function Sheet({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="sheet grid gap-2 border-b border-dashed border-neutral-400 px-[3mm] py-[4mm] last:border-b-0" data-testid={testId}>
      <h2 className="text-[13px] leading-tight font-bold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}

function SellerHeader({ seller }: { seller: Seller }) {
  if (!seller.name && !seller.address) return null;
  return (
    <p className="text-[11px] leading-snug whitespace-pre-line">
      {seller.name && <strong className="block text-[12px]">{seller.name}</strong>}
      {seller.address}
    </p>
  );
}

function OrderHeader({ order }: { order: OrderDetail }) {
  return (
    <>
      <p className="text-[11px] leading-snug">
        {t("Commande")} <strong className="font-mono">{order.externalId}</strong> · {CHANNEL_LABEL[order.channel] ? t(CHANNEL_LABEL[order.channel]!) : order.channel}
        <br />{day().format(new Date(order.orderedAt))}{order.shipment ? ` · ${t(SHIPPING_LABEL[order.shipment.mode])}` : ""}
      </p>
      {(order.buyerName || order.addressLines.length > 0) && (
        <p className="text-[12px] leading-snug">
          <span className="block text-[10px] uppercase">{t("Destinataire")}</span>
          {order.buyerName && <strong className="block">{order.buyerName}</strong>}
          {order.addressLines.map((line, i) => <span key={i} className="block">{line}</span>)}
        </p>
      )}
    </>
  );
}

/** Le document imprimé : liste de prélèvement, puis un bon de livraison et un reçu par commande. */
function Document({ orders, seller, parts }: { orders: OrderDetail[]; seller: Seller; parts: { picking: boolean; slips: boolean; receipts: boolean } }) {
  // Prélèvement : une ligne par exemplaire à aller chercher, rangée par boîte puis par place dans la boîte.
  const picks = useMemo(() => orders
    .flatMap((order) => order.lines.flatMap((line) => line.allocations.map((a) => ({ order, line, a }))))
    .sort((x, y) => x.a.locationCode.localeCompare(y.a.locationCode, "fr", { numeric: true })
      || (x.a.scan?.batchName ?? "").localeCompare(y.a.scan?.batchName ?? "", "fr", { numeric: true })
      || (x.a.scan?.position ?? 0) - (y.a.scan?.position ?? 0)
      || x.a.unitSku.localeCompare(y.a.unitSku)), [orders]);
  const cards = picks.reduce((sum, p) => sum + p.a.qty, 0);

  return (
    <>
      {parts.picking && (
        <Sheet title={t("Prélèvement")} testId="sheet-picking">
          <p className="text-[11px]">{day().format(new Date())} · {tn(orders.length, "{n} commande", "{n} commandes")} · {tn(cards, "{n} carte", "{n} cartes")}</p>
          <ul className="grid gap-1.5">
            {picks.map(({ order, line, a }) => (
              <li key={a.id} className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px] leading-snug">
                <span className="mt-0.5 size-3 border border-black" aria-hidden />
                <span>
                  <strong className="font-mono text-[12px]">{a.locationCode}</strong>
                  {a.scan ? ` · ${t("carte n° {position} ({batch})", { position: a.scan.position, batch: a.scan.batchName })}` : ""} · <span className="font-mono">{a.unitSku}</span>
                  <br />{a.qty} × {cardLine(line)}
                  <br />→ <span className="font-mono">{order.externalId}</span>{order.buyerName ? ` · ${order.buyerName}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {orders.map((order) => (
        <Fragment key={order.id}>
          {parts.slips && (
            <Sheet title={t("Bon de livraison")} testId="sheet-slip">
              <SellerHeader seller={seller} />
              <OrderHeader order={order} />
              <ul className="grid gap-1 border-y border-black py-1.5 text-[11px] leading-snug">
                {order.lines.map((line) => <li key={line.id}>{line.qty} × {cardLine(line)}</li>)}
              </ul>
              <p className="text-[11px]">{tn(order.cards, "{n} carte", "{n} cartes")}. {t("Merci pour votre commande.")}</p>
            </Sheet>
          )}
          {parts.receipts && (
            <Sheet title={t("Reçu")} testId="sheet-receipt">
              <SellerHeader seller={seller} />
              <OrderHeader order={order} />
              <table className="w-full border-y border-black text-[11px] leading-snug">
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.id} className="align-top">
                      <td className="py-0.5 pr-2">{line.qty} × {cardLine(line)}</td>
                      <td className="py-0.5 text-right whitespace-nowrap tabular-nums">{formatEuros(line.qty * line.unitPriceCents)}</td>
                    </tr>
                  ))}
                  {order.totals.shippingChargedCents > 0 && (
                    <tr><td className="py-0.5 pr-2">{t("Frais de port")}</td><td className="py-0.5 text-right whitespace-nowrap tabular-nums">{formatEuros(order.totals.shippingChargedCents)}</td></tr>
                  )}
                </tbody>
              </table>
              <p className="flex justify-between text-[13px] font-bold"><span>{t("Total payé")}</span><span className="tabular-nums">{formatEuros(order.totals.grossCents)}</span></p>
              {seller.legal && <p className="text-[10px] leading-snug whitespace-pre-line">{seller.legal}</p>}
            </Sheet>
          )}
        </Fragment>
      ))}
    </>
  );
}

function Preparation() {
  const autoPrint = useSearchParams().get("imprimer") === "1";
  const [run, setRun] = useState<ShippingRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyNew, setOnlyNew] = useState(true);
  const [parts, setParts] = useState({ picking: true, slips: true, receipts: true });
  const [paper, setPaper] = useState<SlipPaper>("ROLL_80");
  const [seller, setSeller] = useState<Seller>({ name: "", address: "", legal: "" });
  const [printed, setPrinted] = useState(false);
  const [marking, setMarking] = useState(false);
  const launched = useRef(false);

  const load = useCallback(async () => {
    const r = await api.shippingRun();
    setRun(r);
    return r;
  }, []);
  useEffect(() => {
    load().then((r) => {
      setPaper(r.slipPaper);
      setSeller(r.seller);
      // Rien de nouveau : on montre tout, pour pouvoir réimprimer.
      if (!r.orders.some((o) => !o.slipPrintedAt)) setOnlyNew(false);
    }).catch((e: Error) => setError(e.message));
  }, [load]);

  const fresh = run?.orders.filter((o) => !o.slipPrintedAt) ?? [];
  const orders = run ? (onlyNew ? fresh : run.orders) : [];

  useEffect(() => {
    const done = () => setPrinted(true);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);
  // Lien « ?imprimer=1 » : la boîte d'impression s'ouvre dès que le document est prêt (pratique en tâche de démarrage).
  useEffect(() => {
    if (!autoPrint || launched.current || !run || orders.length === 0) return;
    launched.current = true;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [autoPrint, run, orders.length]);

  const savePaper = (next: SlipPaper) => {
    setPaper(next);
    void api.saveAppSettings({ slipPaper: next }).catch((e: Error) => setError(e.message));
  };
  const saveSeller = () => {
    if (run && JSON.stringify(seller) === JSON.stringify(run.seller)) return;
    void api.saveAppSettings({ seller }).then((s) => setRun((r) => (r ? { ...r, seller: s.seller } : r))).catch((e: Error) => setError(e.message));
  };
  async function markPrinted() {
    setMarking(true);
    try {
      const { marked } = await api.markSlipsPrinted(orders.map((o) => o.id));
      toast.success(tn(marked, "{n} commande marquée comme imprimée", "{n} commandes marquées comme imprimées"));
      setPrinted(false);
      // Plus rien de nouveau : on montre tout, pour pouvoir réimprimer.
      if (!(await load()).orders.some((o) => !o.slipPrintedAt)) setOnlyNew(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMarking(false);
    }
  }

  const spec = PAPERS[paper];
  return (
    <div className="grid gap-5 print:block">
      {/* À l'impression, la page ne garde que le document, à la largeur du papier. */}
      <style>{`@media print { @page { ${spec.page} } html, body { background: #fff !important; } [data-sonner-toaster] { display: none !important; } }`}</style>
      <div className="grid gap-5 print:hidden">
        <PageHeader
          back={<BackLink href="/ventes">{t("Ventes")}</BackLink>}
          title={t("Préparer les envois")}
          description={t("Une liste de prélèvement rangée par boîte, puis un bon de livraison et un reçu par commande, au format de votre imprimante.")}
          actions={<Button onClick={() => window.print()} disabled={orders.length === 0 || !Object.values(parts).some(Boolean)} data-testid="print-run"><Printer /> {orders.length > 0 ? tn(orders.length, "Imprimer {n} commande", "Imprimer {n} commandes") : t("Imprimer")}</Button>}
        />
        {error && <Alert variant="destructive">{error}</Alert>}

      </div>

      {!run && !error && <PreparationSkeleton />}

      {run && run.orders.length === 0 && (
        <div className="print:hidden"><EmptyState icon={<Check />} title={t("Rien à préparer")}>{t("Aucune commande n'attend d'être emballée.")}</EmptyState></div>
      )}

      {run && run.orders.length > 0 && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_1fr] print:block">
          <div className="grid gap-4 print:hidden">
            <div className="grid gap-3 rounded-lg border bg-card p-4">
              <p className="text-sm" role="status" data-testid="run-summary">
                <strong className="font-semibold">{tn(run.orders.length, "{n} commande à préparer", "{n} commandes à préparer")}</strong>
                {fresh.length < run.orders.length ? tn(fresh.length, ", dont {n} pas encore imprimée.", ", dont {n} pas encore imprimées.") : "."}
              </p>
              {fresh.length > 0 && fresh.length < run.orders.length && (
                <SwitchRow label={t("Nouvelles commandes seulement")} description={t("Coupé : toutes les commandes à préparer, pour réimprimer.")} checked={onlyNew} onCheckedChange={setOnlyNew} />
              )}
              {(printed || orders.some((o) => !o.slipPrintedAt)) && orders.length > 0 && (
                <Button variant={printed ? "default" : "outline"} onClick={markPrinted} disabled={marking} data-testid="mark-printed">
                  <Check /> {printed ? t("L'impression est bonne : marquer comme imprimées") : t("Marquer comme imprimées")}
                </Button>
              )}
            </div>
            <div className="grid gap-3 rounded-lg border bg-card p-4">
              <Field label={t("Papier")}>
                <Select value={paper} onChange={(e) => savePaper(e.target.value as SlipPaper)} aria-label={t("Papier")}>
                  {(Object.keys(PAPERS) as SlipPaper[]).map((p) => <option key={p} value={p}>{t(PAPERS[p].label)}</option>)}
                </Select>
              </Field>
              <SwitchRow label={t("Liste de prélèvement")} checked={parts.picking} onCheckedChange={(picking) => setParts({ ...parts, picking })} />
              <SwitchRow label={t("Bons de livraison")} checked={parts.slips} onCheckedChange={(slips) => setParts({ ...parts, slips })} />
              <SwitchRow label={t("Reçus")} checked={parts.receipts} onCheckedChange={(receipts) => setParts({ ...parts, receipts })} />
            </div>
            <div className="grid gap-3 rounded-lg border bg-card p-4">
              <p className="text-[13px] font-medium">{t("En-tête des bons et des reçus")}</p>
              <Field label={t("Nom de la boutique")}>
                <Input value={seller.name} onChange={(e) => setSeller({ ...seller, name: e.target.value })} onBlur={saveSeller} maxLength={80} />
              </Field>
              <Field label={t("Adresse")}>
                <Textarea value={seller.address} onChange={(e) => setSeller({ ...seller, address: e.target.value })} onBlur={saveSeller} maxLength={300} className="min-h-16" />
              </Field>
              <Field label={t("Mention du reçu")} hint={t("SIRET, régime de TVA… Imprimée en bas de chaque reçu.")}>
                <Textarea value={seller.legal} onChange={(e) => setSeller({ ...seller, legal: e.target.value })} onBlur={saveSeller} maxLength={300} className="min-h-16" />
              </Field>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/40 p-2 sm:p-4 print:overflow-visible print:rounded-none print:border-0 print:bg-white print:p-0">
            <div
              className="mx-auto max-w-full bg-white font-sans text-black shadow-sm print:max-w-none ring-1 ring-black/10 print:mx-0 print:shadow-none print:ring-0 [&_.sheet]:break-after-page [&_.sheet:last-child]:break-after-auto print:[&_.sheet]:border-0"
              style={{ width: spec.width }}
              data-testid="run-document"
            >
              {orders.length > 0 ? <Document orders={orders} seller={seller} parts={parts} /> : <p className="p-4 text-[12px]">{t("Rien de nouveau à imprimer.")}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PreparationPage() {
  return <Suspense fallback={<PreparationSkeleton />}><Preparation /></Suspense>;
}
