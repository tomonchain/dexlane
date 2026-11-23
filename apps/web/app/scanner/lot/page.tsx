"use client";

import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { LocationField } from "@/components/location-picker";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Code, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { Choice, ChoiceGroup } from "@/components/ui/toggle-group";
import { ApiError, api } from "@/lib/api";
import { formatDateTime, parseEuros } from "@/lib/format";
import { AUTOPILOT_KEY, DEFAULT_AUTOPILOT, DEFAULT_SCAN_SESSION, PUBLISH_MODES, SCAN_SESSION_KEY, type AutopilotPrefs, type ScanSession } from "@/lib/scan";
import { useStored } from "@/lib/storage";
import { CONDITIONS, type CardCondition, type ScanBatch } from "@/lib/types";

export default function ScanBatchesPage() {
  const router = useRouter();
  const [session, setSession] = useStored<ScanSession>(SCAN_SESSION_KEY, DEFAULT_SCAN_SESSION);
  const [batches, setBatches] = useState<ScanBatch[] | null>(null);
  const [condition, setCondition] = useState<CardCondition | null>(null);
  const [paired, setPaired] = useState(true);
  const [auto, setAuto] = useStored<AutopilotPrefs>(AUTOPILOT_KEY, DEFAULT_AUTOPILOT);
  const perDay = /^\d{1,3}$/.test(auto.perDay.trim()) && Number(auto.perDay) >= 1 && Number(auto.perDay) <= 500 ? Number(auto.perDay) : null;
  const autoValid = !auto.on || auto.publishMode !== "DAILY" || perDay !== null;
  // Le pilote automatique a besoin d'un état pour chaque carte : sans choix, « Near Mint ».
  const lotCondition = condition ?? (auto.on ? "NM" : null);
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
      const batch = await api.createScanBatch({
        locationCode: session.locationCode, unitCostCents: costCents, defaultCondition: lotCondition, language: session.language, paired,
        ...(auto.on ? { autopilot: true, publishMode: auto.publishMode, publishPerDay: auto.publishMode === "DAILY" ? perDay : null } : {}),
      });
      router.push(`/scanner/lot/${batch.id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "LOCATION_NOT_FOUND" ? "Cette boîte n'existe pas." : (err as Error).message);
      setCreating(false);
    }
  }

  return (
    <Page width="narrow" className="gap-6">
      <PageHeader title="Lots scannés" description="Un lot = une pile de cartes passée au scanner, qui finit dans une boîte, dans l'ordre." />

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
          <ChoiceGroup value={lotCondition} onValueChange={setCondition} aria-label="État des cartes du lot" className="grid grid-cols-7 gap-1.5">
            {CONDITIONS.map((c) => <Choice key={c.code} value={c.code} aria-label={c.label} title={c.label} className="px-0 font-mono text-[13px]">{c.code}</Choice>)}
          </ChoiceGroup>
          <span className="text-xs text-muted-foreground">{auto.on ? "Appliqué à chaque carte du lot ; modifiable carte par carte avant son entrée en stock." : "Facultatif ici, modifiable carte par carte pendant la revue."}</span>
        </div>
        <SwitchRow label="Recto et verso" description="Le scanner produit deux images par carte : recto puis verso." checked={paired} onCheckedChange={setPaired} />
        <SwitchRow
          label="Pilote automatique"
          description="Chaque carte reconnue sans doute entre en stock, reçoit son prix et part à la mise en ligne, sans attendre la fin du lot. Seules les cartes à vérifier vous attendent."
          checked={auto.on}
          onCheckedChange={(on) => setAuto({ ...auto, on })}
        />
        {auto.on && (
          <div className="grid gap-1.5" data-testid="autopilot-publish">
            <span className="text-[13px] leading-none font-medium text-foreground/80">Mise en ligne</span>
            <div className="flex flex-wrap items-center gap-2">
              <ChoiceGroup value={auto.publishMode} onValueChange={(mode) => mode && setAuto({ ...auto, publishMode: mode })} aria-label="Mise en ligne" className="flex flex-wrap gap-1.5">
                {PUBLISH_MODES.map((m) => <Choice key={m.value} value={m.value} className="px-3 text-[13px]">{m.label}</Choice>)}
              </ChoiceGroup>
              {auto.publishMode === "DAILY" && (
                <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Input inputMode="numeric" value={auto.perDay} onChange={(e) => setAuto({ ...auto, perDay: e.target.value })} aria-label="Mises en ligne par jour" aria-invalid={perDay === null} className="tabular h-9 w-16 text-center md:h-9" />
                  par jour
                </label>
              )}
            </div>
            <span className="text-xs text-muted-foreground">Sur chaque canal de vente activé dans les réglages.</span>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={creating || !session.locationCode || costCents === null || !autoValid} className="justify-self-start">
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
                  {b.receivedAt ? "En stock" : b.counts.toReview > 0 ? `${b.counts.toReview} à corriger` : b.autopilot ? `Pilote automatique · ${b.counts.received} en stock` : b.counts.items > 0 ? "Prêt" : "Vide"}
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
