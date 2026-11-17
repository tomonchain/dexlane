"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CardThumb } from "@/components/CardChooser";
import { api } from "@/lib/api";
import { LIFECYCLE, positionSubtitle, positionTitle } from "@/lib/format";
import type { InventoryPage, Position } from "@/lib/types";

const PAGE = 50;

export default function InventoryPage() {
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [kind, setKind] = useState("");
  const [location, setLocation] = useState("");
  const [page, setPage] = useState<InventoryPage | null>(null);
  const [items, setItems] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);

  // Lien depuis l'écran Rangement : /inventaire?emplacement=BOX-03
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get("emplacement");
    if (preset) setLocation(preset);
  }, []);

  // Recherche différée : une requête par pause de frappe, la dernière réponse seule est affichée.
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api.inventory({ q: q.trim(), lifecycle, kind, location: location.trim(), limit: PAGE })
        .then((r) => {
          if (id !== request.current) return;
          setPage(r);
          setItems(r.items);
          setError(null);
        })
        .catch((e: Error) => id === request.current && setError(e.message))
        .finally(() => id === request.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, lifecycle, kind, location]);

  async function more() {
    const id = request.current;
    setLoading(true);
    try {
      const r = await api.inventory({ q: q.trim(), lifecycle, kind, location: location.trim(), limit: PAGE, offset: items.length });
      if (id === request.current) setItems((prev) => [...prev, ...r.items]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <h1>Inventaire</h1>
        {page && <span className="muted small" role="status">{page.total} position{page.total > 1 ? "s" : ""}</span>}
      </div>

      <div className="stack-sm">
        <input
          className="input"
          type="search"
          placeholder="Nom de carte, SKU de position ou d'offre"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Rechercher"
          autoCorrect="off"
        />
        <div className="grid-2">
          <select className="input" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} aria-label="Statut">
            <option value="">En stock (hors archives)</option>
            <option value="ACTIVE">Actives</option>
            <option value="DRAFT">Brouillons</option>
            <option value="ARCHIVED">Archivées</option>
            <option value="ALL">Toutes</option>
          </select>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Tous les types</option>
            <option value="FUNGIBLE">Cartes interchangeables</option>
            <option value="UNIQUE">Exemplaires uniques</option>
            <option value="BULK">Vrac</option>
          </select>
        </div>
        <input
          className="input"
          placeholder="Emplacement (BOX-03 inclut BOX-03/ROW-12…)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          aria-label="Emplacement"
          autoCapitalize="characters"
          autoCorrect="off"
        />
      </div>

      {error && <p className="banner error" role="alert">{error}</p>}
      {!error && page && items.length === 0 && !loading && (
        <p className="card muted center">Aucune position ne correspond.</p>
      )}

      <div className="list">
        {items.map((p) => (
          <Link key={p.id} className="rowlink" href={`/inventaire/${p.unitSku}`}>
            {p.card ? <CardThumb imageUrl={p.card.imageUrl} /> : <div className="thumb placeholder" aria-hidden="true">vrac</div>}
            <span className="grow" style={{ minWidth: 0 }}>
              <strong className="truncate" style={{ display: "block" }}>{positionTitle(p)}</strong>
              <span className="muted small truncate" style={{ display: "block" }}>{positionSubtitle(p)}</span>
              <span className="small row wrap" style={{ gap: 6, marginTop: 4 }}>
                <span className="mono muted">{p.unitSku}</span>
                <span className="mono">{p.locationCode}</span>
                {p.lifecycle !== "ACTIVE" && <span className="badge warn">{LIFECYCLE[p.lifecycle]}</span>}
                {p.reserved > 0 && <span className="badge accent">{p.reserved} réservée{p.reserved > 1 ? "s" : ""}</span>}
              </span>
            </span>
            <span className="qty" title="En stock">{p.onHand}</span>
          </Link>
        ))}
      </div>

      {loading && <p className="row muted" role="status"><span className="spinner" /> Chargement…</p>}
      {page && items.length < page.total && !loading && (
        <button type="button" className="btn block" onClick={more}>Afficher la suite ({page.total - items.length} restantes)</button>
      )}
    </div>
  );
}
