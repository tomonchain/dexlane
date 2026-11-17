"use client";

import { ChevronRight, MapPin, Plus, ReceiptText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Code, EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { ApiError, api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros } from "@/lib/format";
import type { AcquisitionLot, Location } from "@/lib/types";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ

export default function StoragePage() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [lots, setLots] = useState<AcquisitionLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"location" | "lot" | null>(null);

  const load = useCallback(() => {
    Promise.all([api.locations(), api.lots()])
      .then(([l, a]) => {
        setLocations(l.locations);
        setLots(a.lots);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="grid gap-5">
      <PageHeader title="Rangement" description="Où sont les cartes, et d'où elles viennent." />
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <div className="grid gap-1">
              <CardTitle>Emplacements</CardTitle>
              <CardDescription>Pièce, meuble, boîte, rangée, position.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setModal("location")}><Plus /> Nouvel emplacement</Button>
          </CardHeader>
          {!locations && !error && <Loading className="px-5 pb-5" />}
          {locations?.length === 0 && (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <EmptyState icon={<MapPin />} title="Aucun emplacement">Créez une boîte pour commencer à ranger : BOX-01, puis BOX-01/ROW-01…</EmptyState>
            </div>
          )}
          {locations && locations.length > 0 && (
            <div className="divide-y border-t">
              {locations.map((l) => {
                const depth = l.code.split("/").length - 1;
                return (
                  <Link key={l.id} href={`/inventaire?emplacement=${encodeURIComponent(l.code)}`} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent sm:px-5">
                    <span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${depth * 1.1}rem` }}>
                      {depth > 0 && <span className="h-4 w-2.5 shrink-0 rounded-bl border-b border-l border-muted-foreground/30" aria-hidden />}
                      <span className="min-w-0">
                        <Code className="block truncate">{l.code}</Code>
                        {l.description && <span className="block truncate text-xs text-muted-foreground">{l.description}</span>}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{l.positions} position{l.positions > 1 ? "s" : ""}</span>
                    <span className="tabular w-10 text-right font-semibold">{l.cards}</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-4">
            <div className="grid gap-1">
              <CardTitle>Lots d'acquisition</CardTitle>
              <CardDescription>Provenance et coût d'achat des cartes.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setModal("lot")}><Plus /> Nouveau lot</Button>
          </CardHeader>
          {!lots && !error && <Loading className="px-5 pb-5" />}
          {lots?.length === 0 && (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              <EmptyState icon={<ReceiptText />} title="Aucun lot">Un lot relie des cartes à leur provenance et à leur coût d'achat.</EmptyState>
            </div>
          )}
          {lots && lots.length > 0 && (
            <div className="divide-y border-t">
              {lots.map((l) => (
                <div key={l.id} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.sourceType}{l.sellerRef ? ` · ${l.sellerRef}` : ""}</span>
                    <span className="block text-xs text-muted-foreground">{l.purchaseDate}{l.shippingCostCents ? ` · port ${formatEuros(l.shippingCostCents)}` : ""}</span>
                  </span>
                  <span className="tabular font-semibold">{formatEuros(l.totalCostCents)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground lg:hidden" onClick={() => void api.logout().then(() => window.location.assign("/login"))}>
        Se déconnecter
      </Button>

      {modal === "location" && <NewLocation onClose={() => setModal(null)} onCreated={load} />}
      {modal === "lot" && <NewLot onClose={() => setModal(null)} onCreated={load} />}
    </div>
  );
}

function NewLocation({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createLocation(code, description.trim() || undefined);
      toast.success(created.created ? `Emplacement ${created.code} créé` : `L'emplacement ${created.code} existait déjà`);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "INVALID_LOCATION_CODE"
        ? "Code invalide : lettres, chiffres et tirets, jusqu'à 5 niveaux séparés par « / » (ex. BOX-03/ROW-12/SLOT-04)."
        : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouvel emplacement" description="Les niveaux parents sont créés automatiquement." onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Code">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BOX-03/ROW-12" autoCapitalize="characters" autoCorrect="off" required autoFocus className="font-mono" />
        </Field>
        <Field label="Description (facultatif)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Étagère du haut" />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy || !code.trim()}>Créer l'emplacement</Button>
      </form>
    </Modal>
  );
}

function NewLot({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [sourceType, setSourceType] = useState("");
  const [sellerRef, setSellerRef] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(today);
  const [total, setTotal] = useState("");
  const [shipping, setShipping] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyring = useRef(createKeyring());

  const totalCents = parseEuros(total);
  const shippingCents = parseEuros(shipping);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (totalCents === null || shippingCents === null) return;
    setBusy(true);
    setError(null);
    const payload = {
      sourceType: sourceType.trim(),
      sellerRef: sellerRef.trim() || undefined,
      purchaseDate,
      totalCostCents: totalCents,
      shippingCostCents: shippingCents || undefined,
    };
    try {
      await api.createLot(payload, keyring.current.keyFor(payload));
      toast.success("Lot d'acquisition enregistré");
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouveau lot d'acquisition" onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="Provenance">
          <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="Collection personnelle, particulier…" required maxLength={80} autoFocus />
        </Field>
        <Field label="Vendeur / référence">
          <Input value={sellerRef} onChange={(e) => setSellerRef(e.target.value)} maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date d'achat">
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
          </Field>
          <Field label="Coût total (€)">
            <Input inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={total !== "" && totalCents === null} required className="tabular" />
          </Field>
        </div>
        <Field label="Frais de port (€)">
          <Input inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} aria-invalid={shippingCents === null} className="tabular" />
        </Field>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" size="lg" disabled={busy || !sourceType.trim() || totalCents === null || shippingCents === null}>Enregistrer le lot</Button>
      </form>
    </Modal>
  );
}
