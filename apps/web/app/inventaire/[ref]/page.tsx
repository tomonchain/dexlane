"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CardThumb } from "@/components/CardChooser";
import { LocationPicker } from "@/components/LocationPicker";
import { Sheet } from "@/components/Sheet";
import { Stepper } from "@/components/Stepper";
import { ApiError, api, createKeyring } from "@/lib/api";
import { LIFECYCLE, formatDateTime, formatEuros, movementLabel, positionSubtitle, positionTitle } from "@/lib/format";
import type { PositionDetail } from "@/lib/types";

const KIND: Record<string, string> = { UNIQUE: "Exemplaire unique", FUNGIBLE: "Interchangeable", BULK: "Vrac" };
const ERRORS: Record<string, string> = {
  ADJUST_BELOW_COMMITTED: "Des cartes de cette position sont réservées pour une commande : traitez d'abord la commande concernée.",
  LOCATION_NOT_FOUND: "Cet emplacement n'existe pas.",
  NOT_DRAFT: "Cette position ne peut pas être validée.",
};
const message = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? e.message) : (e as Error).message);

export default function PositionPage() {
  const { ref } = useParams<{ ref: string }>();
  const [position, setPosition] = useState<PositionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sheet, setSheet] = useState<"move" | "adjust" | null>(null);
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

  if (notFound) {
    return (
      <div className="stack">
        <h1>Position introuvable</h1>
        <p className="muted">Aucune position ne porte le code <span className="mono">{decodeURIComponent(ref)}</span>.</p>
        <Link className="btn" href="/inventaire">Retour à l'inventaire</Link>
      </div>
    );
  }
  if (!position) return error ? <p className="banner error" role="alert">{error}</p> : <p className="row muted" role="status"><span className="spinner" /> Chargement…</p>;

  const p = position;
  async function run(action: () => Promise<PositionDetail>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSheet(null);
      load();
    } catch (e) {
      setError(message(e));
      setSheet(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Link className="muted small" href="/inventaire">← Inventaire</Link>
      <div className="row" style={{ alignItems: "flex-start" }}>
        {p.card && <CardThumb imageUrl={p.card.imageUrl} large />}
        <div className="stack-sm grow">
          <h1>{positionTitle(p)}</h1>
          <p className="muted">{positionSubtitle(p)}</p>
          <div className="row wrap">
            <span className={p.lifecycle === "ACTIVE" ? "badge ok" : "badge warn"}>{LIFECYCLE[p.lifecycle]}</span>
            <span className="badge">{KIND[p.kind]}</span>
            {p.card?.variantIncomplete && <span className="badge warn">Variante à confirmer</span>}
          </div>
        </div>
      </div>

      {error && <p className="banner error" role="alert">{error}</p>}
      {p.lifecycle === "DRAFT" && (
        <p className="banner warn">Brouillon : cette position n'est pas vendable tant qu'elle n'est pas validée.</p>
      )}

      <section className="card">
        <dl className="facts">
          <div><dt>Position</dt><dd className="mono">{p.unitSku}</dd></div>
          <div><dt>Emplacement</dt><dd className="mono">{p.locationCode}</dd></div>
          <div><dt>En stock</dt><dd data-testid="on-hand">{p.onHand}</dd></div>
          <div><dt>Disponible à la vente</dt><dd>{p.lifecycle === "ACTIVE" ? p.availableToSell : 0}</dd></div>
          {p.reserved > 0 && <div><dt>Réservé</dt><dd>{p.reserved}</dd></div>}
          {p.inspection > 0 && <div><dt>En inspection</dt><dd>{p.inspection}</dd></div>}
          {p.quarantine > 0 && <div><dt>En quarantaine</dt><dd>{p.quarantine}</dd></div>}
          <div><dt>Coût unitaire</dt><dd>{formatEuros(p.unitCostCents)}</dd></div>
          {p.offer && <div style={{ gridColumn: "1 / -1" }}><dt>Offre</dt><dd className="mono">{p.offer.offerSku}</dd></div>}
        </dl>
      </section>

      <div className="row wrap">
        {p.lifecycle === "DRAFT" && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => run(() => api.activate(p.id))}>Valider (rendre vendable)</button>
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => setSheet("move")}>Déplacer</button>
        <button type="button" className="btn" disabled={busy} onClick={() => setSheet("adjust")}>Corriger le stock</button>
        {p.kind === "BULK" && p.availableToSell > 0 && (
          <Link className="btn" href={`/?vrac=${p.id}`}>Extraire une carte</Link>
        )}
      </div>

      <section className="card">
        <h2 className="section-title">Historique</h2>
        <ul className="timeline">
          {p.movements.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{movementLabel(m)}</strong>
                {m.movementType === "MOVE" && <span className="mono small"> {m.fromLocationCode} → {m.toLocationCode}</span>}
                {m.reason && <span className="small"> — {m.reason}</span>}
                <span className="muted small" style={{ display: "block" }}>{formatDateTime(m.createdAt)} · {m.actor}</span>
              </span>
              {m.qtyDelta !== 0 && m.bucket === "on_hand" && (
                <span className={m.qtyDelta > 0 ? "delta plus" : "delta minus"}>{m.qtyDelta > 0 ? "+" : "−"}{Math.abs(m.qtyDelta)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {sheet === "move" && (
        <LocationPicker value={p.locationCode} onClose={() => setSheet(null)} onPick={(code) => run(() => api.move(p.id, code))} />
      )}
      {sheet === "adjust" && <AdjustSheet position={p} busy={busy} onClose={() => setSheet(null)} onSubmit={(count, reason, key) => run(() => api.adjust(p.id, count, reason, key))} />}
    </div>
  );
}

function AdjustSheet({ position, busy, onClose, onSubmit }: {
  position: PositionDetail;
  busy: boolean;
  onClose: () => void;
  onSubmit: (count: number, reason: string, key: string) => void;
}) {
  const [count, setCount] = useState(position.onHand);
  const [reason, setReason] = useState("");
  const keyring = useRef(createKeyring());
  const committed = position.reserved + position.inspection + position.quarantine;

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(count, reason.trim(), keyring.current.keyFor({ id: position.id, count, reason: reason.trim() }));
  }

  return (
    <Sheet title="Corriger le stock" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">Saisissez la quantité réellement comptée à l'emplacement <span className="mono">{position.locationCode}</span>. Le système enregistre l'écart ({position.onHand} actuellement).</p>
        <div className="field">
          <span className="label">Quantité comptée</span>
          <Stepper value={count} onChange={setCount} min={0} max={position.kind === "UNIQUE" ? 1 : 1_000_000} label="Quantité comptée" />
        </div>
        {count < committed && <p className="banner warn">{committed} carte{committed > 1 ? "s sont engagées" : " est engagée"} (commande, inspection ou quarantaine) : la correction sera refusée.</p>}
        <label className="field">
          <span>Motif (obligatoire)</span>
          <textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. comptage du 17/11, carte abîmée retirée" required />
        </label>
        <button className="btn primary block" disabled={busy || count === position.onHand || !reason.trim()}>
          {count === position.onHand ? "Aucun écart" : `Enregistrer l'écart (${count - position.onHand > 0 ? "+" : "−"}${Math.abs(count - position.onHand)})`}
        </button>
      </form>
    </Sheet>
  );
}
