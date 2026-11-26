"use client";

import { ArrowRight, Check, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Logo } from "@/components/app-shell";
import { PasswordInput } from "@/components/password-input";
import { StrategyPicker } from "@/components/strategy-picker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { parseEuros } from "@/lib/format";
import { INTAKE, type IntakeMode } from "@/lib/intake";
import { authMessage } from "@/lib/auth-messages";
import { t, tn } from "@/lib/i18n";
import { LANGUAGES } from "@/lib/scan";
import type { AppSettings, CatalogSet, PricingSettings, ShippingCosts } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Les étapes dépendent de qui démarre : le propriétaire d'une installation neuve crée d'abord son compte et importe ses
 * séries dans le catalogue ; un vendeur qui vient de s'inscrire a déjà son compte, et le catalogue est commun.
 */
type StepId = "account" | "shop" | "intake" | "series" | "locations" | "pricing";
const LABELS: Record<StepId, string> = { account: "Compte", shop: "Boutique", intake: "Scan", series: "Séries", locations: "Rangement", pricing: "Envois et prix" };
const stepsFor = (opts: { account: boolean; admin: boolean }): StepId[] => [
  ...(opts.account ? (["account"] as const) : []), "shop", "intake", ...(opts.admin ? (["series"] as const) : []), "locations", "pricing",
];


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
  const [steps, setSteps] = useState<StepId[]>([]);
  const [step, setStep] = useState<number | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.authStatus()
      .then(async (s) => {
        // Installation neuve : son propriétaire crée son compte, puis règle le reste.
        if (!s.passwordSet) {
          setSteps(stepsFor({ account: true, admin: true }));
          return setStep(0);
        }
        const [account, current] = await Promise.all([api.account(), api.appSettings()]);
        setSettings(current);
        setSteps(stepsFor({ account: false, admin: account.role === "admin" }));
        setStep(0);
      })
      .catch((e) => setError(authMessage(e)));
  }, []);

  const next = useCallback(() => setStep((s) => (s ?? 0) + 1), []);
  const current = step === null ? null : (steps[step] ?? null);
  async function finish(href: string) {
    await api.saveAppSettings({ onboardingDone: true }).catch(() => undefined);
    window.location.assign(href);
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-2xl content-start gap-8 px-4 py-8 sm:py-12">
      <header className="grid gap-5">
        <div className="flex items-center justify-between">
          <Logo />
          {current && current !== "account" && (
            <button type="button" onClick={() => finish("/")} className="text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline">
              {t("Passer l'assistant")}
            </button>
          )}
        </div>
        {step !== null && current && (
          <ol className="flex gap-1.5" aria-label={t("Étapes de démarrage")}>
            {steps.map((id, index) => (
              <li key={id} className="grid flex-1 gap-1.5" aria-current={index === step ? "step" : undefined}>
                <span className={cn("h-1 rounded-full", index < step ? "bg-foreground" : index === step ? "bg-brand" : "bg-border")} />
                <span className={cn("hidden text-xs sm:block", index === step ? "font-medium text-foreground" : "text-muted-foreground")}>{t(LABELS[id])}</span>
              </li>
            ))}
          </ol>
        )}
      </header>

      {error && <p role="alert" data-slot="alert" data-variant="destructive" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive">{error}</p>}
      {step === null && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> {t("Chargement…")}</p>}
      {current === "account" && <AccountStep onDone={async () => { setSettings(await api.appSettings()); next(); }} />}
      {current === "shop" && <ShopStep initial={settings} onDone={(saved) => { if (saved) setSettings(saved); next(); }} />}
      {current === "intake" && <IntakeStep initial={settings?.intakeMode ?? null} onDone={(saved) => { setSettings(saved); next(); }} />}
      {current === "series" && <SeriesStep onDone={next} />}
      {current === "locations" && <LocationsStep onDone={next} />}
      {current === "pricing" && <PricingStep onDone={next} />}
      {step !== null && steps.length > 0 && step >= steps.length && (
        <section className="grid gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{t("Tout est prêt")}</h1>
            <p className="text-sm text-muted-foreground">{t("Chaque réglage reste modifiable dans Réglages. Il ne manque plus que tes cartes.")}</p>
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

// ───────────────────────── Compte ─────────────────────────

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
        title={t("Crée ton compte")}
        description={t("Choisis l'adresse e-mail et le mot de passe qui protégeront ton stock. Le jeton d'installation prouve que ce serveur est le tien ; il n'est demandé que cette fois.")}
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

// ───────────────────────── Boutique ─────────────────────────

/** Le nom et les coordonnées imprimés sur les bons de livraison et les reçus. */
function ShopStep({ initial, onDone }: { initial: AppSettings | null; onDone: (saved: AppSettings | null) => void }) {
  const [seller, setSeller] = useState(initial?.seller ?? { name: "", address: "", legal: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api.saveAppSettings({ seller }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Step
        title={t("Ta boutique")}
        description={t("Ton nom de vendeur et tes coordonnées sont imprimés sur chaque bon de livraison et chaque reçu.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => onDone(null)}>{t("Passer cette étape")}</Button>
            <Button type="submit" size="lg" disabled={busy}>{busy ? <Spinner className="text-primary-foreground" /> : null} {t("Continuer")} <ArrowRight /></Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label={t("Nom de la boutique")}>
            <Input value={seller.name} onChange={(e) => setSeller({ ...seller, name: e.target.value })} maxLength={80} placeholder={t("Ma boutique de cartes")} autoFocus />
          </Field>
          <Field label={t("Adresse")} hint={t("Une ligne par élément : rue, code postal et ville, pays.")}>
            <Textarea value={seller.address} onChange={(e) => setSeller({ ...seller, address: e.target.value })} maxLength={300} className="min-h-20" />
          </Field>
          <Field label={t("Mention du reçu")} hint={t("SIRET, régime de TVA… Imprimée en bas de chaque reçu.")}>
            <Textarea value={seller.legal} onChange={(e) => setSeller({ ...seller, legal: e.target.value })} maxLength={300} className="min-h-16" />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
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
      title={t("Comment scannes-tu tes cartes ?")}
      description={t("L'écran d'ajout s'adapte à ton matériel. Tu pourras toujours utiliser les autres façons.")}
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
    })().catch(() => !cancelled && setError(t("La liste des séries n'a pas pu être chargée (catalogue en ligne injoignable). Tu pourras importer tes séries plus tard, depuis Réglages → Catalogue.")));
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
      title={t("Quelles séries as-tu ?")}
      description={t("Une carte ne peut être reconnue que si sa série est importée. Choisis celles que tu possèdes ; d'autres pourront suivre plus tard.")}
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
      title={t("Où ranges-tu tes cartes ?")}
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
          {t("Écris ces codes sur tes boîtes et classeurs.")}
          {existing ? ` ${tn(existing, "Vous avez déjà {n} emplacement : ceux qui existent sont conservés.", "Vous avez déjà {n} emplacements : ceux qui existent sont conservés.")}` : ""}
          {" "}{t("D'autres s'ajoutent à tout moment depuis Réglages → Emplacements.")}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Step>
  );
}

// ───────────────────────── Envois et prix ─────────────────────────

const POSTAGE: { mode: keyof ShippingCosts["postage"]; label: string }[] = [
  { mode: "LETTER_UNTRACKED", label: "Lettre simple" },
  { mode: "LETTER_TRACKED", label: "Lettre suivie" },
  { mode: "PARCEL_TRACKED", label: "Colis suivi" },
];
const euros = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/** Ce que coûte un envoi (il entre dans la marge de chaque vente) et la façon de fixer les prix. */
function PricingStep({ onDone }: { onDone: () => void }) {
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [costs, setCosts] = useState<ShippingCosts | null>(null);
  const [postage, setPostage] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<PricingSettings["strategy"]>("BALANCED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.pricingSettings(), api.shippingCosts()]).then(([pricing, shipping]) => {
      setSettings(pricing);
      setStrategy(pricing.strategy);
      setCosts({ postage: shipping.postage, supplies: shipping.supplies });
      setPostage(Object.fromEntries(POSTAGE.map(({ mode }) => [mode, euros(shipping.postage[mode])])));
    }).catch((e: Error) => setError(e.message));
  }, []);

  async function save() {
    if (!settings || !costs) return;
    const parsed = {} as ShippingCosts["postage"];
    for (const { mode, label } of POSTAGE) {
      const text = (postage[mode] ?? "").trim();
      const cents = text === "" ? null : parseEuros(text);
      if (text !== "" && cents === null) return setError(t("{label} : montant invalide.", { label: t(label) }));
      parsed[mode] = cents;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveShippingCosts({ postage: parsed, supplies: costs.supplies });
      await api.savePricingSettings({ ...settings, strategy });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Step
      title={t("Tes envois et tes prix")}
      description={t("Ce que te coûte un envoi entre dans la marge de chaque vente. Chaque carte reçoit ensuite un prix dès son entrée en stock, d'après les ventes réussies sur Cardmarket.")}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>{t("Passer cette étape")}</Button>
          <Button size="lg" disabled={busy || !settings || !costs} onClick={save}>{t("Terminer")} <ArrowRight /></Button>
        </>
      }
    >
      <div className="grid gap-5">
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">{t("Affranchissement habituel")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {POSTAGE.map(({ mode, label }) => (
              <Field key={mode} label={t(label)} hint={t("En euros.")}>
                <Input inputMode="decimal" value={postage[mode] ?? ""} onChange={(e) => setPostage({ ...postage, [mode]: e.target.value })} placeholder="0,00" disabled={!costs} />
              </Field>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">{t("Laisse vide ce que tu n'utilises pas. Sleeves, top-loaders et enveloppes se règlent dans Réglages → Envois.")}</p>
        </fieldset>
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">{t("Stratégie de prix")}</legend>
          <StrategyPicker value={strategy} onChange={setStrategy} />
          <ul className="grid gap-1.5 text-[13px] text-muted-foreground">
            <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("Jamais sous ton prix d'achat : si le marché est en dessous, le prix est tenu au coût et la carte est signalée.")}</li>
            <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("Un pic isolé des ventes ne fait pas grimper le prix de plus de 25 %.")}</li>
            <li className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> {t("Un prix que tu fixes à la main n'est plus jamais modifié tout seul.")}</li>
          </ul>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </Step>
  );
}
