"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LocationPicker } from "@/components/LocationPicker";
import { ApiError, api, createKeyring } from "@/lib/api";
import { formatEuros, parseEuros } from "@/lib/format";
import { useStored } from "@/lib/storage";
import type { AcquisitionLot, ReceivedBulkLot } from "@/lib/types";

const TYPES = ["communes", "peu communes", "rares", "holos", "reverses", "dresseurs", "énergies", "mélange"];
const LANGUAGES: [string, string][] = [["", "Mélangées / inconnue"], ["fr", "Français"], ["en", "Anglais"], ["de", "Allemand"], ["it", "Italien"], ["es", "Espagnol"], ["ja", "Japonais"]];

export default function BulkPage() {
  const [locationCode, setLocationCode] = useStored("dexlane.bulk.location", "");
  const [cardType, setCardType] = useState("communes");
  const [scope, setScope] = useState("");
  const [scopeKind, setScopeKind] = useState<"setId" | "era">("era");
  const [language, setLanguage] = useState("fr");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("0");
  const [lotId, setLotId] = useState("");
  const [lots, setLots] = useState<AcquisitionLot[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReceivedBulkLot | null>(null);
  const keyring = useRef(createKeyring());

  useEffect(() => {
    api.lots().then((r) => setLots(r.lots)).catch(() => setLots([]));
  }, []);

  const count = /^\d{1,7}$/.test(quantity.trim()) ? Number(quantity) : 0;
  const totalCents = parseEuros(cost);
  const ready = count > 0 && totalCents !== null && locationCode !== "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    const payload = {
      descriptor: {
        cardType,
        [scopeKind]: scope.trim() || undefined,
        language: language || undefined,
      },
      quantity: count,
      locationCode,
      totalCostCents: totalCents!,
      acquisitionLotId: lotId || undefined,
    };
    try {
      setDone(await api.receiveBulk(payload, keyring.current.keyFor(payload)));
      keyring.current.reset();
      setQuantity("");
    } catch (err) {
      setError(err instanceof ApiError && err.code === "LOCATION_NOT_FOUND" ? "Cet emplacement n'existe pas." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="stack-sm">
        <h1>Lot de vrac</h1>
        <p className="muted">Un lot compté ou pesé entre en une seule position, sans scanner chaque carte.</p>
      </div>

      {done && (
        <section className="card stack-sm" aria-live="polite">
          <p className="banner ok"><strong>Lot enregistré.</strong></p>
          <p className="sku">{done.stockItem.unitSku}</p>
          <p><strong>{done.descriptor.label}</strong> × {done.stockItem.onHand}, rangé en <span className="mono">{done.locationCode}</span></p>
          <p className="muted small">Coût unitaire retenu : {formatEuros(done.stockItem.unitCostCents)} (arrondi au centime).</p>
          <Link className="btn ghost sm" href={`/inventaire/${done.stockItem.unitSku}`}>Voir la fiche</Link>
        </section>
      )}

      <section className="card stack-sm">
        <h2 className="section-title">Contenu</h2>
        <div className="chips" role="radiogroup" aria-label="Type de cartes">
          {TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={t === cardType} className="chip" onClick={() => setCardType(t)}>{t}</button>
          ))}
        </div>
        <div className="grid-2">
          <label className="field">
            <span>Regroupement</span>
            <select className="input" value={scopeKind} onChange={(e) => setScopeKind(e.target.value as "setId" | "era")}>
              <option value="era">Époque</option>
              <option value="setId">Série (identifiant)</option>
            </select>
          </label>
          <label className="field">
            <span>{scopeKind === "era" ? "Époque (facultatif)" : "Série (facultatif)"}</span>
            <input className="input" value={scope} onChange={(e) => setScope(e.target.value)} placeholder={scopeKind === "era" ? "Écarlate et Violet" : "sv01"} autoCorrect="off" />
          </label>
        </div>
        <label className="field">
          <span>Langue</span>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
      </section>

      <section className="card stack-sm">
        <h2 className="section-title">Quantité et coût</h2>
        <div className="grid-2">
          <label className="field">
            <span>Nombre de cartes</span>
            <input className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1000" required />
          </label>
          <label className="field">
            <span>Coût total du lot (€)</span>
            <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} onFocus={(e) => e.target.select()} aria-invalid={totalCents === null} />
          </label>
        </div>
        <label className="field">
          <span>Lot d'acquisition</span>
          <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Aucun</option>
            {lots.map((l) => <option key={l.id} value={l.id}>{l.purchaseDate} · {l.sourceType}{l.sellerRef ? ` · ${l.sellerRef}` : ""}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="label" id="bulk-location">Emplacement</span>
          <button type="button" className="btn" aria-labelledby="bulk-location" onClick={() => setPicking(true)} style={{ justifyContent: "space-between" }}>
            <span className={locationCode ? "mono" : "muted"}>{locationCode || "Choisir…"}</span>
            <span className="muted small">Changer</span>
          </button>
        </div>
      </section>

      {error && <p className="banner error" role="alert">{error}</p>}
      <button className="btn primary big block" disabled={busy || !ready}>{busy ? "Enregistrement…" : "Enregistrer le lot"}</button>

      {picking && (
        <LocationPicker value={locationCode} onClose={() => setPicking(false)} onPick={(code) => { setLocationCode(code); setPicking(false); }} />
      )}
    </form>
  );
}
