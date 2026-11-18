"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LocationField } from "@/components/location-picker";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Code, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, parseEuros } from "@/lib/format";
import { DEFAULT_SCAN_SESSION, SCAN_SESSION_KEY, type ScanSession } from "@/lib/scan";
import { useStored } from "@/lib/storage";
import { CONDITIONS, type CardCondition, type ScanBatch } from "@/lib/types";

export default function ScanBatchesPage() {
  const router = useRouter();
  const [session, setSession] = useStored<ScanSession>(SCAN_SESSION_KEY, DEFAULT_SCAN_SESSION);
  const [batches, setBatches] = useState<ScanBatch[] | null>(null);
  const [condition, setCondition] = useState<CardCondition | null>(null);
  const [paired, setPaired] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.scanBatches().then((r) => setBatches(r.batches)).catch((e: Error) => setError(e.message));
  }, []);

  const costCents = parseEuros(session.cost);
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!session.locationCode || costCents === null) return;
    setCreating(true);
    setError(null);
    try {
      const batch = await api.createScanBatch({ locationCode: session.locationCode, unitCostCents: costCents, defaultCondition: condition, language: session.language, paired });
      router.push(`/scanner/lot/${batch.id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "LOCATION_NOT_FOUND" ? "Cette boîte n'existe pas." : (err as Error).message);
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Lots scannés</h1>
        <p className="text-sm text-muted-foreground">Un lot = une pile de cartes passée au scanner, qui finit dans une boîte, dans l'ordre.</p>
      </div>

      <form onSubmit={create} className="grid gap-4 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Nouveau lot</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <LocationField label="Boîte de destination" value={session.locationCode} onChange={(code) => setSession({ ...session, locationCode: code })} />
          <Field label="Coût unitaire (€)">
            <Input inputMode="decimal" value={session.cost} onChange={(e) => setSession({ ...session, cost: e.target.value })} aria-invalid={costCents === null} className="tabular" />
          </Field>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] leading-none font-medium text-foreground/80">État des cartes du lot</span>
          <ChoiceGroup value={condition} onValueChange={setCondition} aria-label="État des cartes du lot" className="grid grid-cols-7 gap-1.5">
            {CONDITIONS.map((c) => <Choice key={c.code} value={c.code} aria-label={c.label} title={c.label} className="px-0 font-mono text-[13px]">{c.code}</Choice>)}
          </ChoiceGroup>
          <span className="text-xs text-muted-foreground">Facultatif ici, modifiable carte par carte pendant la revue.</span>
        </div>
        <SwitchRow label="Recto et verso" description="Le scanner produit deux images par carte : recto puis verso." checked={paired} onCheckedChange={setPaired} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={creating || !session.locationCode || costCents === null} className="justify-self-start">
          {creating ? <Spinner className="text-primary-foreground" /> : <Plus />} Créer le lot
        </Button>
      </form>

      {batches && batches.length > 0 && (
        <section className="grid gap-2">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">Lots</h2>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {batches.map((b) => (
              <Link key={b.id} href={`/scanner/lot/${b.id}`} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm font-medium">{b.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    <Code className="text-xs">{b.locationCode}</Code> · {b.counts.items} carte{b.counts.items > 1 ? "s" : ""} · {formatDateTime(b.createdAt)}
                  </span>
                </span>
                <span className="text-[13px] whitespace-nowrap text-muted-foreground">
                  {b.receivedAt ? "En stock" : b.counts.toReview > 0 ? `${b.counts.toReview} à corriger` : b.counts.items > 0 ? "Prêt" : "Vide"}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
