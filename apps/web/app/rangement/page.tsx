"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros } from "@/lib/format";
import type { AcquisitionLot, Location } from "@/lib/types";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }); // AAAA-MM-JJ

export default function StoragePage() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [lots, setLots] = useState<AcquisitionLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="stack">
      <h1>Rangement</h1>
      {error && <p className="banner error" role="alert">{error}</p>}

      <section className="card stack-sm">
        <h2 className="section-title">Emplacements</h2>
        <NewLocation onCreated={load} />
        {locations?.length === 0 && <p className="muted small">Aucun emplacement pour l'instant.</p>}
        <div className="list">
          {locations?.map((l) => (
            <Link key={l.id} className="rowlink" href={`/inventaire?emplacement=${encodeURIComponent(l.code)}`} style={{ paddingLeft: 12 + 14 * (l.code.split("/").length - 1) }}>
              <span className="grow">
                <span className="mono">{l.code}</span>
                {l.description && <span className="muted small" style={{ display: "block" }}>{l.description}</span>}
              </span>
              <span className="muted small">{l.positions} position{l.positions > 1 ? "s" : ""}</span>
              <span className="qty">{l.cards}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card stack-sm">
        <h2 className="section-title">Lots d'acquisition</h2>
        <NewLot onCreated={load} />
        {lots?.length === 0 && <p className="muted small">Aucun lot. Un lot relie des cartes à leur provenance et à leur coût d'achat.</p>}
        <div className="list">
          {lots?.map((l) => (
            <div key={l.id} className="rowlink">
              <span className="grow">
                <strong>{l.sourceType}</strong>{l.sellerRef ? ` · ${l.sellerRef}` : ""}
                <span className="muted small" style={{ display: "block" }}>{l.purchaseDate}{l.shippingCostCents ? ` · port ${formatEuros(l.shippingCostCents)}` : ""}</span>
              </span>
              <span className="qty">{formatEuros(l.totalCostCents)}</span>
            </div>
          ))}
        </div>
      </section>

      <button type="button" className="btn danger" onClick={() => void api.logout().then(() => window.location.assign("/login"))}>Se déconnecter</button>
    </div>
  );
}

function NewLocation({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createLocation(code, description.trim() || undefined);
      setMessage({ kind: "ok", text: created.created ? `Emplacement ${created.code} créé.` : `L'emplacement ${created.code} existait déjà.` });
      setCode("");
      setDescription("");
      onCreated();
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof ApiError && err.code === "INVALID_LOCATION_CODE"
          ? "Code invalide : lettres, chiffres et tirets, jusqu'à 5 niveaux séparés par « / » (ex. BOX-03/ROW-12/SLOT-04)."
          : (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-sm" onSubmit={submit}>
      <div className="grid-2">
        <label className="field">
          <span>Nouveau code</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BOX-03/ROW-12" autoCapitalize="characters" autoCorrect="off" required />
        </label>
        <label className="field">
          <span>Description (facultatif)</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </label>
      </div>
      <button className="btn" disabled={busy || !code.trim()}>Créer l'emplacement</button>
      {message && <p className={`banner ${message.kind}`} role="status">{message.text}</p>}
    </form>
  );
}

function NewLot({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
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
      keyring.current.reset();
      setOpen(false);
      setSourceType("");
      setSellerRef("");
      setTotal("");
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>Nouveau lot d'acquisition</button>;
  return (
    <form className="stack-sm" onSubmit={submit}>
      <div className="grid-2">
        <label className="field">
          <span>Provenance</span>
          <input className="input" value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="collection personnelle, particulier…" required maxLength={80} />
        </label>
        <label className="field">
          <span>Vendeur / référence</span>
          <input className="input" value={sellerRef} onChange={(e) => setSellerRef(e.target.value)} maxLength={200} />
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Date d'achat</span>
          <input className="input" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>Coût total (€)</span>
          <input className="input" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} aria-invalid={total !== "" && totalCents === null} required />
        </label>
      </div>
      <label className="field">
        <span>Frais de port (€)</span>
        <input className="input" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} aria-invalid={shippingCents === null} />
      </label>
      {error && <p className="banner error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Annuler</button>
        <button className="btn primary grow" disabled={busy || !sourceType.trim() || totalCents === null || shippingCents === null}>Enregistrer le lot</button>
      </div>
    </form>
  );
}
