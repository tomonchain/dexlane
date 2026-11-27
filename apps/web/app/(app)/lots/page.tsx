"use client";

import { Megaphone, Package, PackageOpen, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CardThumb } from "@/components/card-chooser";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Code, EmptyState, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { api } from "@/lib/api";
import { formatEuros, formatNumber, parseEuros } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import { eurosInput } from "@/lib/pricing";
import type { ChannelState, ListingOffer, SaleLot } from "@/lib/types";

const STATUS: Record<SaleLot["status"], { label: string; variant: "success" | "warning" | "neutral" | "outline" }> = {
  IN_STOCK: { label: "À vendre", variant: "neutral" },
  RESERVED: { label: "Dans une vente", variant: "warning" },
  SOLD: { label: "Vendu", variant: "success" },
  DISSOLVED: { label: "Défait", variant: "outline" },
};

/** Lots : des cartes du stock vendues ensemble, en une annonce. On les crée depuis la sélection du stock. */
export default function LotsPage() {
  const [lots, setLots] = useState<SaleLot[] | null>(null);
  const [offers, setOffers] = useState<ListingOffer[]>([]);
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<SaleLot | null>(null);

  const load = async () => {
    try {
      const [l, o, c] = await Promise.all([api.saleLots(), api.listingOffers({ limit: 200 }), api.channels()]);
      setLots(l.lots);
      setOffers(o.items.filter((i) => i.kind === "LOT"));
      setChannels(c.channels.filter((ch) => ch.mode !== "OFF"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => void load(), []);

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const active = lots?.filter((l) => l.status !== "DISSOLVED") ?? [];
  const dissolved = lots?.filter((l) => l.status === "DISSOLVED") ?? [];
  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        title={t("Lots de vente")}
        description={t("Regroupe tes communes et tes doubles : un lot, une annonce, une seule carte décomptée de ton forfait. Pour en créer un, coche des cartes dans le stock puis « Créer un lot ».")}
        actions={<Button asChild variant="outline"><Link href="/stock">{t("Choisir des cartes")}</Link></Button>}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!lots ? !error && <Loading /> : active.length === 0 && dissolved.length === 0 ? (
        <EmptyState icon={<Package className="size-6" />} title={t("Aucun lot pour l'instant")}>
          {t("Dans le stock, coche au moins deux cartes, puis choisis « Créer un lot ».")}
        </EmptyState>
      ) : (
        <ul className="grid gap-3" data-testid="sale-lots">
          {[...active, ...dissolved].map((lot) => {
            const offer = offers.find((o) => o.offerId === lot.offerId);
            const status = STATUS[lot.status];
            return (
              <li key={lot.offerId} className="grid gap-3 rounded-lg border bg-card p-4" data-testid={`sale-lot-${lot.offerSku}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <h2 className="text-[15px] font-semibold [overflow-wrap:anywhere]">{lot.title}</h2>
                    <p className="text-[13px] text-muted-foreground">
                      <Code>{lot.offerSku}</Code> · {tn(lot.cards, "{n} carte", "{n} cartes")} · {t("coût {cost}", { cost: formatEuros(lot.costCents) })}
                      {lot.locationCode && <> · <Code>{lot.locationCode}</Code></>}
                    </p>
                  </div>
                  <span className="tabular text-lg font-semibold">{lot.priceCents === null ? "—" : formatEuros(lot.priceCents)}</span>
                  <Badge variant={status.variant}>{t(status.label)}</Badge>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {lot.members.map((m) => (
                    <li key={m.stockItemId} className="flex items-center gap-2 rounded-md border px-2 py-1 text-[13px]">
                      <CardThumb imageUrl={m.imageUrl} size="sm" />
                      <span className="grid">
                        <span className="font-medium">{m.name}{m.qty > 1 && <span className="tabular text-muted-foreground"> × {m.qty}</span>}</span>
                        <span className="text-xs text-muted-foreground">{[m.setName, m.localNumber, m.condition].filter(Boolean).join(" · ")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                {lot.status === "IN_STOCK" && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {channels.map((channel) => {
                      const listing = offer?.listings.find((l) => l.channel === channel.id);
                      return listing ? (
                        <span key={channel.id} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px]">
                          {channel.label} · {listing.status === "ACTIVE" ? t("en ligne") : t("en pause")}
                          <Button variant="ghost" size="icon-sm" disabled={busy !== null} aria-label={t("Retirer l'annonce {channel}", { channel: channel.label })}
                            onClick={() => run(`end:${listing.id}`, () => api.endListing(listing.id), t("Annonce retirée"))}><X /></Button>
                        </span>
                      ) : (
                        <Button key={channel.id} size="sm" variant="outline" disabled={busy !== null || !offer || offer.missing.length > 0}
                          onClick={() => run(`pub:${channel.id}`, () => api.publishListing(lot.offerId, channel.id), t("Lot publié sur {channel}", { channel: channel.label }))}>
                          {busy === `pub:${channel.id}` ? <Spinner /> : <Megaphone />} {t("Publier sur {channel}", { channel: channel.label })}
                        </Button>
                      );
                    })}
                    {channels.length === 0 && <span className="text-[13px] text-muted-foreground">{t("Active un canal de vente pour publier ce lot.")}</span>}
                    {offer && offer.missing.includes("PHOTO") && <span className="text-[13px] text-muted-foreground">{t("Ajoute une photo à l'une de ses cartes pour le publier.")}</span>}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(lot)}><Pencil /> {t("Modifier")}</Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null}
                        onClick={() => window.confirm(t("Défaire « {title} » ? Ses annonces sont retirées et ses cartes reviennent dans le stock, à l'unité.", { title: lot.title }))
                          && void run(`dissolve:${lot.offerId}`, () => api.dissolveSaleLot(lot.offerId), t("Lot défait : les cartes sont de retour dans le stock"))}>
                        {busy === `dissolve:${lot.offerId}` ? <Spinner /> : <PackageOpen />} {t("Défaire")}
                      </Button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <LotEditor
          lot={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}

function LotEditor({ lot, onClose, onSaved }: { lot: SaleLot; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(lot.title);
  const [description, setDescription] = useState(lot.description ?? "");
  const [price, setPrice] = useState(lot.priceCents === null ? "" : eurosInput(lot.priceCents));
  const [busy, setBusy] = useState(false);
  const cents = parseEuros(price);
  async function save() {
    if (cents === null) return;
    setBusy(true);
    try {
      await api.updateSaleLot(lot.offerId, { title: title.trim(), description: description.trim() || null, priceCents: cents });
      toast.success(t("Lot enregistré"));
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Modifier le lot")} onClose={onClose}>
      <div className="grid gap-4">
        <Field label={t("Titre de l'annonce")} hint={t("{n} / 80 caractères", { n: formatNumber(title.length) })}>
          <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("Prix du lot (€)")}>
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={cents === null} className="tabular" />
        </Field>
        <Field label={t("Texte en tête de description")} hint={t("La liste des cartes suit toujours.")}>
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <Button onClick={save} disabled={busy || !title.trim() || cents === null}>{busy && <Spinner />} {t("Enregistrer")}</Button>
      </div>
    </Modal>
  );
}
