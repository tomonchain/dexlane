"use client";

import { ArrowRight, Check, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Logo } from "@/components/app-shell";
import { Channels } from "@/components/listings";
import { PasswordInput } from "@/components/password-input";
import { StrategyPicker } from "@/components/strategy-picker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { INTAKE, type IntakeMode } from "@/lib/intake";
import { authMessage } from "@/lib/auth-messages";
import { t, tn } from "@/lib/i18n";
import { LANGUAGES } from "@/lib/scan";
import type { AppSettings, CatalogSet, ChannelState, PricingSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = ["Compte", "Scan", "Séries", "Emplacements", "Prix", "Canaux"] as const;


function Step({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer: ReactNode }) {
  return (
    <section className="grid gap-5">
      <div className="grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">{footer}</div>
    </section>
  );
}

export default function WelcomePage() {
  const [step, setStep] = useState<number | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sans compte, on commence par le créer ; avec un compte, l'assistant reprend au choix du mode de scan.
  useEffect(() => {
    api.authStatus()
      .then(async (s) => {
        if (!s.passwordSet) return setStep(0);
        setSettings(await api.appSettings());
        setStep(1);
      })
      .catch((e) => setError(authMessage(e)));
  }, []);

  const next = useCallback(() => setStep((s) => (s ?? 0) + 1), []);
  async function finish(href: string) {
    await api.saveAppSettings({ onboardingDone: true }).catch(() => undefined);
    window.location.assign(href);
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-2xl content-start gap-8 px-4 py-8 sm:py-12">
      <header className="grid gap-5">
        <div className="flex items-center justify-between">
          <Logo />
          {step !== null && step >= 1 && step < STEPS.length && (
            <button type="button" onClick={() => finish("/")} className="text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">
              {t("Passer l'assistant")}
            </button>
          )}
        </div>
        {step !== null && step < STEPS.length && (
          <ol className="flex gap-1.5" aria-label={t("Étapes de démarrage")}>
            {STEPS.map((label, index) => (
              <li key={label} className="grid flex-1 gap-1.5" aria-current={index === step ? "step" : undefined}>
                <span className={cn("h-1 rounded-full", index < step ? "bg-foreground" : index === step ? "bg-brand" : "bg-border")} />
                <span className={cn("hidden text-xs sm:block", index === step ? "font-medium text-foreground" : "text-muted-foreground")}>{t(label)}</span>
              </li>
            ))}
          </ol>
        )}
      </header>

      {error && <p role="alert" data-slot="alert" data-variant="destructive" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      {step === null && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> {t("Chargement…")}</p>}
      {step === 0 && <AccountStep onDone={async () => { setSettings(await api.appSettings()); next(); }} />}
      {step === 1 && <IntakeStep initial={settings?.intakeMode ?? null} onDone={(s) => { setSettings(s); next(); }} />}
      {step === 2 && <SeriesStep onDone={next} />}
      {step === 3 && <LocationsStep onDone={next} />}
      {step === 4 && <PricingStep onDone={next} />}
      {step === 5 && <ChannelsStep onDone={next} />}
      {step === STEPS.length && (
        <section className="grid gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{t("Tout est prêt")}</h1>
            <p className="text-sm text-muted-foreground">{t("Chaque réglage reste modifiable dans Réglages. Il ne manque plus que vos cartes.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => finish("/scanner/batch")}>
              {settings?.intakeMode === "CAMERA" ? t("Créer mon premier lot à photographier") : settings?.intakeMode === "FILES" ? t("Créer mon premier lot d'images") : t("Créer mon premier lot scanné")} <ArrowRight />
            </Button>
            <Button size="lg" variant="outline" onClick={() => finish("/stock")}>{t("Aller au stock")}</Button>
          </div>
        </section>
      )}
    </div>
  );
}

// ───────────────────────── 1. Compte ─────────────────────────

function AccountStep({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError(t("Les deux mots de passe ne sont pas identiques."));
    setBusy(true);
    setError(null);
    try {
      await api.setupOwner(token, email.trim(), password);
      onDone();
    } catch (err) {
      setError(authMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Step
        title={t("Créez votre compte")}
        description={t("Choisissez l'adresse e-mail et le mot de passe qui protégeront votre stock. Le jeton d'installation prouve que ce serveur est le vôtre ; il n'est demandé que cette fois.")}
        footer={<Button type="submit" size="lg" disabled={busy}>{busy ? <Spinner className="text-primary-foreground" /> : null} {t("Créer mon compte")} <ArrowRight /></Button>}
      >
        <div className="grid gap-4">
          <Field label={t("Jeton d'installation")} hint={t("La valeur de DEXLANE_API_TOKEN, définie à l'installation.")}>
            <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" className="font-mono" required autoFocus />
          </Field>
          <Field label={t("Adresse e-mail")}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Mot de passe")} hint={t("10 caractères au moins.")}>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required />
            </Field>
            <Field label={t("Confirmer le mot de passe")}>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
          </div>
          {error && <p role="alert" data-slot="alert" data-variant="destructive" className="text-sm text-destructive">{error}</p>}
        </div>
      </Step>
    </form>
  );
}

// ───────────────────────── 2. Mode de scan ─────────────────────────

function IntakeStep({ initial, onDone }: { initial: IntakeMode | null; onDone: (settings: AppSettings) => void }) {
  const [mode, setMode] = useState<IntakeMode | null>(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Step
      title={t("Comment scannez-vous vos cartes ?")}
      description={t("L'écran d'ajout s'adapte à votre matériel. Vous pourrez toujours utiliser les autres façons.")}
      footer={
        <Button size="lg" disabled={!mode || busy} onClick={async () => { setBusy(true); onDone(await api.saveAppSettings({ intakeMode: mode })); }}>
          {t("Continuer")} <ArrowRight />
        </Button>
      }
    >
      <div role="radiogroup" aria-label={t("Mode de scan")} className="grid gap-2">
        {INTAKE.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setMode(option.value)}
            className={cn(
              "flex items-center gap-4 rounded-lg border bg-card p-4 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/30",
              mode === option.value && "border-foreground ring-1 ring-foreground hover:bg-card",
            )}
          >
            <option.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="grid gap-0.5">
              <span className="text-sm font-semibold">{t(option.label)}</span>
              <span className="text-[13px] text-muted-foreground">{t(option.hint)}</span>
            </span>
          </button>
        ))}
      </div>
    </Step>
  );
}

// ───────────────────────── 3. Séries ─────────────────────────

interface ImportState {
  done: number;
  total: number;
  current: string;
  cards: number;
  failed: string[];
  finished: boolean;
}

function SeriesStep({ onDone }: { onDone: () => void }) {
  const [language, setLanguage] = useState("fr");
  const [sets, setSets] = useState<CatalogSet[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportState | null>(null);
  const stop = useRef(false);

  const [reload, setReload] = useState(0);
  // La liste des séries vient du catalogue en ligne. Elle est chargée d'office si elle manque ou si elle ne contient
  // que des séries déjà importées (elle n'a alors jamais été chargée en entier), et sur demande.
  useEffect(() => {
    let cancelled = false;
    setSets(null);
    setError(null);
    (async () => {
      let list = (await api.catalogSets(language)).sets;
      if (reload > 0 || list.every((set) => set.cardsSynced > 0)) {
        await api.refreshCatalogSets(language);
        list = (await api.catalogSets(language)).sets;
      }
      if (!cancelled) setSets(list);
    })().catch(() => !cancelled && setError(t("La liste des séries n'a pas pu être chargée (catalogue en ligne injoignable). Vous pourrez importer vos séries plus tard, depuis Réglages → Catalogue.")));
    return () => {
      cancelled = true;
    };
  }, [language, reload]);

  const blocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (sets ?? []).filter((s) => !q || `${s.name} ${s.id} ${s.serieName ?? ""}`.toLowerCase().includes(q));
    const byBlock = new Map<string, CatalogSet[]>();
    const others = t("Autres séries");
    for (const set of shown) byBlock.set(set.serieName ?? others, [...(byBlock.get(set.serieName ?? others) ?? []), set]);
    return [...byBlock.entries()].sort((a, b) => (b[1][0]!.seriePosition ?? -1) - (a[1][0]!.seriePosition ?? -1));
  }, [sets, query]);

  const toggle = (ids: string[], on: boolean) => setSelected((current) => {
    const nextSet = new Set(current);
    for (const id of ids) if (on) nextSet.add(id); else nextSet.delete(id);
    return nextSet;
  });

  async function run() {
    const queue = (sets ?? []).filter((s) => selected.has(s.id));
    stop.current = false;
    let state: ImportState = { done: 0, total: queue.length, current: queue[0]?.name ?? "", cards: 0, failed: [], finished: false };
    setProgress(state);
    for (const set of queue) {
      if (stop.current) break;
      state = { ...state, current: set.name };
      setProgress(state);
      try {
        const report = await api.syncCatalogSet(set.id, language);
        state = { ...state, done: state.done + 1, cards: state.cards + report.cards };
      } catch {
        state = { ...state, done: state.done + 1, failed: [...state.failed, set.name] };
      }
      setProgress(state);
    }
    setProgress({ ...state, finished: true });
  }

  if (progress) {
    const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 100;
    return (
      <Step
        title={t("Import des séries")}
        description={t("Les cartes, leurs variantes et leurs cotes sont téléchargées série par série.")}
        footer={progress.finished
          ? <Button size="lg" onClick={onDone}>{t("Continuer")} <ArrowRight /></Button>
          : <Button variant="outline" onClick={() => (stop.current = true)}>{t("Arrêter après cette série")}</Button>}
      >
        <div className="grid gap-3 rounded-lg border bg-card p-4" data-testid="import-progress">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{progress.finished ? t("Import terminé") : progress.current}</span>
            <span className="tabular text-muted-foreground">{progress.done} / {progress.total}</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label={t("Avancement de l'import")} className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${percent}%` }} />
          </div>
          <p className="tabular text-[13px] text-muted-foreground">
            {tn(progress.cards, "{n} carte importée", "{n} cartes importées")}
            {progress.failed.length > 0 && ` · ${tn(progress.failed.length, "{n} série en échec : {sets}", "{n} séries en échec : {sets}", { sets: progress.failed.join(", ") })}`}
          </p>
        </div>
      </Step>
    );
  }

  return (
    <Step
      title={t("Quelles séries avez-vous ?")}
      description={t("Une carte ne peut être reconnue que si sa série est importée. Choisissez celles que vous possédez ; d'autres pourront suivre plus tard.")}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>{t("Passer cette étape")}</Button>
          <Button size="lg" disabled={selected.size === 0} onClick={run}>{tn(selected.size, "Importer {n} série", "Importer {n} séries")} <ArrowRight /></Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 basis-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Nom de série ou de bloc")} aria-label={t("Rechercher une série")} className="pl-9" />
          </div>
          <Select value={language} onChange={(e) => { setLanguage(e.target.value); setSelected(new Set()); }} aria-label={t("Langue des cartes")} className="w-auto">
            {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{t(label)}</option>)}
          </Select>
          <Button variant="outline" disabled={!sets && !error} onClick={() => setReload((n) => n + 1)}>{t("Actualiser la liste")}</Button>
        </div>
        {error && <p role="alert" className="rounded-md border bg-muted/50 px-3 py-2 text-sm">{error}</p>}
        {!sets && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> {t("Chargement de la liste des séries…")}</p>}
        {sets && (
          <div className="max-h-[26rem] overflow-y-auto rounded-lg border bg-card">
            {blocks.map(([block, list]) => {
              const importable = list.filter((s) => s.cardsSynced === 0).map((s) => s.id);
              const all = importable.length > 0 && importable.every((id) => selected.has(id));
              return (
                <fieldset key={block} className="border-b last:border-b-0">
                  <legend className="sr-only">{block}</legend>
                  <label className="sticky top-0 flex cursor-pointer items-center gap-3 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
                    <input type="checkbox" checked={all} disabled={importable.length === 0} onChange={(e) => toggle(importable, e.target.checked)} className="size-4 accent-foreground" />
                    <span className="flex-1">{block}</span>
                    <span className="tabular font-normal">{tn(list.length, "{n} série", "{n} séries")}</span>
                  </label>
                  {list.map((set) => (
                    <label key={set.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50">
                      <input type="checkbox" checked={set.cardsSynced > 0 || selected.has(set.id)} disabled={set.cardsSynced > 0} onChange={(e) => toggle([set.id], e.target.checked)} className="size-4 accent-foreground" />
                      <span className="min-w-0 flex-1 truncate">{set.name}</span>
                      <span className="tabular text-xs text-muted-foreground">
                        {set.cardsSynced > 0 ? t("déjà importée") : set.cardCountTotal ? tn(set.cardCountTotal, "{n} carte", "{n} cartes") : set.id.toUpperCase()}
                      </span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
            {blocks.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("Aucune série ne correspond.")}</p>}
          </div>
        )}
      </div>
    </Step>
  );
}

// ───────────────────────── 4. Emplacements ─────────────────────────

const codes = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);

function LocationsStep({ onDone }: { onDone: () => void }) {
  const [boxes, setBoxes] = useState("3");
  const [binders, setBinders] = useState("0");
  const [existing, setExisting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.locations().then((r) => setExisting(r.locations.length)).catch(() => setExisting(0));
  }, []);

  const count = (value: string) => (/^\d{1,2}$/.test(value.trim()) ? Number(value) : null);
  const [nBoxes, nBinders] = [count(boxes), count(binders)];
  const planned = nBoxes !== null && nBinders !== null ? [...codes("BOITE", nBoxes), ...codes("CLASSEUR", nBinders)] : null;

  async function create() {
    if (!planned) return;
    setBusy(true);
    setError(null);
    try {
      if (planned.length > 0) await api.createLocations(planned);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Step
      title={t("Où rangez-vous vos cartes ?")}
      description={t("Chaque carte en stock a un emplacement, pour la retrouver le jour de la vente. Un lot scanné va dans une boîte, dans l'ordre du scan.")}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>{t("Passer cette étape")}</Button>
          <Button size="lg" disabled={busy || !planned} onClick={create}>
            {planned && planned.length > 0 ? tn(planned.length, "Créer {n} emplacement", "Créer {n} emplacements") : t("Continuer")} <ArrowRight />
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("Nombre de boîtes")}><Input inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value)} aria-invalid={nBoxes === null} className="tabular" /></Field>
          <Field label={t("Nombre de classeurs")}><Input inputMode="numeric" value={binders} onChange={(e) => setBinders(e.target.value)} aria-invalid={nBinders === null} className="tabular" /></Field>
        </div>
        {planned && planned.length > 0 && (
          <p className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed" data-testid="location-preview">{planned.join("  ")}</p>
        )}
        <p className="text-[13px] text-muted-foreground">
          {t("Écrivez ces codes sur vos boîtes et classeurs.")}
          {existing ? ` ${tn(existing, "Vous avez déjà {n} emplacement : ceux qui existent sont conservés.", "Vous avez déjà {n} emplacements : ceux qui existent sont conservés.")}` : ""}
          {" "}{t("D'autres s'ajoutent à tout moment depuis Réglages → Emplacements.")}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Step>
  );
}

// ───────────────────────── 5. Prix ─────────────────────────

function PricingStep({ onDone }: { onDone: () => void }) {
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [strategy, setStrategy] = useState<PricingSettings["strategy"]>("BALANCED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.pricingSettings().then((s) => {
      setSettings(s);
      setStrategy(s.strategy);
    }).catch((e: Error) => setError(e.message));
  }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      await api.savePricingSettings({ ...settings, strategy });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Step
      title={t("Comment fixer vos prix ?")}
      description={t("Chaque carte reçoit un prix dès son entrée en stock, d'après les ventes réussies sur Cardmarket : celles du mois, ajustées par celles de la semaine.")}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>{t("Passer cette étape")}</Button>
          <Button size="lg" disabled={busy || !settings} onClick={save}>{t("Continuer")} <ArrowRight /></Button>
        </>
      }
    >
      <div className="grid gap-4">
        <StrategyPicker value={strategy} onChange={setStrategy} />
        <ul className="grid gap-1.5 text-[13px] text-muted-foreground">
          <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("Jamais sous votre prix d'achat : si le marché est en dessous, le prix est tenu au coût et la carte est signalée.")}</li>
          <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("Un pic isolé des ventes ne fait pas grimper le prix de plus de 25 %.")}</li>
          <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("Un prix que vous fixez à la main n'est plus jamais modifié tout seul.")}</li>
        </ul>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Step>
  );
}

// ───────────────────────── 6. Canaux ─────────────────────────

function ChannelsStep({ onDone }: { onDone: () => void }) {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  useEffect(() => {
    api.channels().then((r) => setChannels(r.channels)).catch(() => setChannels([]));
  }, []);
  return (
    <Step
      title={t("Où vendez-vous ?")}
      description={t("Activez un canal en simulation pour essayer la mise en ligne sans rien publier. Le mode réel s'ouvre quand l'accès à la marketplace est configuré.")}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>{t("Passer cette étape")}</Button>
          <Button size="lg" onClick={onDone}>{t("Terminer")} <ArrowRight /></Button>
        </>
      }
    >
      <Channels channels={channels} onChange={setChannels} compact />
    </Step>
  );
}
