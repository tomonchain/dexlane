"use client";

import { ChevronRight, Flag, Medal, ScrollText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";
import { insights, levelLabel, salesToGo, type HomeInsights, type Preferences } from "@/lib/insights";
import { t, tn } from "@/lib/i18n";
import { ProgressBar } from "./onboarding";

function Row({ href, icon, title, hint, children }: { href: string; icon: ReactNode; title: string; hint: string; children?: ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4" aria-hidden>{icon}</span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
        {children}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Dans le compte : la progression, le parcours de démarrage, les récaps, et les réglages qui vont avec. */
export function AccountInsights() {
  const [home, setHome] = useState<HomeInsights | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [recaps, setRecaps] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => insights.home().then(setHome).catch(() => undefined);
  useEffect(() => {
    void load();
    insights.preferences().then(setPrefs).catch(() => undefined);
    insights.recaps().then((r) => setRecaps(r.recaps.length)).catch(() => undefined);
  }, []);

  const save = (change: Partial<Preferences>) => {
    if (!prefs) return;
    setPrefs({ ...prefs, ...change });
    insights.savePreferences(change).then((p) => {
      setPrefs(p);
      void load();
    }).catch((e: Error) => setError(e.message));
  };

  const level = home?.progression?.level;
  return (
    <>
      <div className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="account-insights">
        {home?.progression && level && (
          <Row href="/progress" icon={<Medal />} title={t("Progression")}
            hint={level.level > 0 ? `${levelLabel(level.level)}${level.next ? ` · ${salesToGo(level.next.salesNeeded)}` : ""}` : t("Pas encore de niveau")}>
            {level.next && <ProgressBar percent={level.progressPercent} label={t("Vers le niveau {n}", { n: level.next.level })} className="h-1.5 max-w-56" />}
          </Row>
        )}
        {home && (
          <Row href="/getting-started" icon={<Flag />} title={t("Démarrage")}
            hint={home.onboarding.complete ? t("Les sept étapes sont faites") : t("Compte configuré à {x} %", { x: home.onboarding.percent })} />
        )}
        <Row href="/recap" icon={<ScrollText />} title={t("Récaps")}
          hint={recaps === null || recaps === 0 ? t("Le 1er de chaque mois, ce que ton mois a donné") : tn(recaps, "{n} récap", "{n} récaps")} />
      </div>

      {prefs && (
        <Card>
          <CardContent className="grid gap-3">
            <div className="grid gap-1">
              <CardTitle>{prefs.recapEmailAvailable ? t("Progression et récaps") : t("Statistiques et progression")}</CardTitle>
              <CardDescription>{t("Tes réglages à toi, pas ceux de toute l'équipe.")}</CardDescription>
            </div>
            <SwitchRow label={t("Afficher le niveau et les succès")}
              description={t("Désactivé, le niveau, la page Progression, les notifications de succès et la partie progression des récaps disparaissent. Les statistiques et le démarrage restent.")}
              checked={prefs.showProgression} onCheckedChange={(on) => save({ showProgression: on })} />
            {prefs.recapEmailAvailable && (
              <SwitchRow label={t("E-mail du récap mensuel")} description={t("Un e-mail court le 1er du mois, avec le lien vers ton récap.")}
                checked={prefs.recapEmail} onCheckedChange={(on) => save({ recapEmail: on })} />
            )}
            <TimezoneField value={prefs.timezone} onChange={(timezone) => save({ timezone })} />
            {error && <Alert variant="destructive">{error}</Alert>}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Les fuseaux connus du navigateur ; à défaut, le fuseau actuel et celui du navigateur. */
function timezones(current: string, browser: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([current, browser, ...all])].sort((a, b) => a.localeCompare(b));
}

/**
 * Le fuseau des statistiques (semaines, mois, périodes) ; celui du propriétaire du compte sert aussi à la régularité et
 * aux récaps. Le navigateur propose le sien quand il diffère.
 */
function TimezoneField({ value, onChange }: { value: string; onChange: (timezone: string) => void }) {
  const [browser, setBrowser] = useState(value);
  useEffect(() => setBrowser(Intl.DateTimeFormat().resolvedOptions().timeZone || value), [value]);
  return (
    <div className="grid gap-1.5 py-1">
      <Field label={t("Fuseau horaire")} hint={t("Les semaines et les mois des statistiques commencent à minuit, dans ce fuseau.")}>
        <Select value={value} onChange={(e) => onChange(e.target.value)} data-testid="timezone">
          {timezones(value, browser).map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
        </Select>
      </Field>
      {browser !== value && (
        <button type="button" onClick={() => onChange(browser)} className="justify-self-start text-xs font-medium text-primary underline-offset-2 hover:underline">
          {t("Utiliser celui de cet appareil ({timezone})", { timezone: browser.replace(/_/g, " ") })}
        </button>
      )}
    </div>
  );
}
