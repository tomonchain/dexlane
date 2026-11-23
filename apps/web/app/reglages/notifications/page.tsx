"use client";

import { BellOff, BellRing, Send, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { BackLink, Loading, Page, PageHeader, Spinner } from "@/components/ui/misc";
import { SwitchRow } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { t, tn } from "@/lib/i18n";
import { currentSubscription, disablePush, enablePush, pushSupport, type PushSupport } from "@/lib/push";

type Preferences = { sales: boolean; watched: boolean; publications: boolean };
const KINDS: { key: keyof Preferences; label: string; hint: string }[] = [
  { key: "sales", label: "Ventes", hint: "Les ventes arrivées d'eBay ou de CardTrader, à préparer." },
  { key: "watched", label: "Cartes suivies", hint: "Une carte suivie passe sous votre prix cible." },
  { key: "publications", label: "Mises en ligne", hint: "Les publications du jour qui n'ont pas pu partir." },
];

/** Notifications sur le téléphone : un résumé chaque matin, seulement quand il y a du nouveau. */
export default function NotificationSettingsPage() {
  const [info, setInfo] = useState<{ publicKey: string; devices: number; preferences: Preferences } | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.notifications().then(setInfo).catch((e: Error) => setError(e.message));
    setSupport(pushSupport());
    currentSubscription().then((s) => setSubscribed(s !== null)).catch(() => setSubscribed(false));
  }, []);
  useEffect(load, [load]);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const done = await action();
      if (done) toast.success(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }

  const enable = () => run(async () => {
    if (!(await enablePush(info!.publicKey))) {
      setSupport(pushSupport());
      return null;
    }
    return t("Notifications activées sur cet appareil");
  });
  const disable = () => run(async () => {
    await disablePush();
    return t("Notifications désactivées sur cet appareil");
  });
  const test = () => run(async () => {
    const r = await api.testPush();
    return r.sent > 0 ? tn(r.sent, "Notification d'essai envoyée à {n} appareil", "Notification d'essai envoyée à {n} appareils") : t("Aucun appareil n'a pu être joint.");
  });
  const setPreference = (key: keyof Preferences, value: boolean) => run(async () => {
    const preferences = { ...info!.preferences, [key]: value };
    setInfo({ ...info!, preferences });
    await api.saveAppSettings({ notifications: preferences });
    return null;
  });

  return (
    <Page width="narrow" className="mx-auto w-full">
      <PageHeader
        back={<BackLink href="/reglages">Réglages</BackLink>}
        title={t("Notifications")}
        description={t("Un résumé chaque matin sur votre téléphone, seulement quand il y a du nouveau : ventes à préparer, cartes suivies sous votre prix cible, mises en ligne en échec.")}
      />
      {error && <Alert variant="destructive">{error}</Alert>}
      {!info || support === null || subscribed === null ? !error && <Loading /> : (
        <>
          <Card>
            <CardContent className="grid gap-4" data-testid="push-device">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
                  {subscribed ? <BellRing className="size-5 text-brand" /> : <Smartphone className="size-5" />}
                </span>
                <div className="grid gap-1">
                  <CardTitle>{subscribed ? t("Activées sur cet appareil") : t("Cet appareil")}</CardTitle>
                  <CardDescription>
                    {support === "install-first" ? t("Sur iPhone et iPad, ajoutez d'abord Dexlane à l'écran d'accueil (Partager › Sur l'écran d'accueil), puis ouvrez-le depuis cette icône pour activer les notifications.")
                      : support === "denied" ? t("Les notifications sont bloquées pour Dexlane dans les réglages du navigateur ou du téléphone. Autorisez-les, puis revenez ici.")
                      : support === "unsupported" ? t("Ce navigateur ne gère pas les notifications.")
                      : subscribed ? t("Vous recevrez le résumé du matin ici.")
                      : t("Activez-les pour recevoir le résumé du matin sur cet appareil.")}
                  </CardDescription>
                </div>
              </div>
              {support === "ready" && (
                <div className="flex flex-wrap gap-2">
                  {subscribed ? (
                    <>
                      <Button variant="outline" onClick={test} disabled={busy}>{busy ? <Spinner /> : <Send />} {t("Envoyer une notification d'essai")}</Button>
                      <Button variant="ghost" onClick={disable} disabled={busy}><BellOff /> {t("Désactiver")}</Button>
                    </>
                  ) : (
                    <Button onClick={enable} disabled={busy}>{busy ? <Spinner /> : <BellRing />} {t("Activer les notifications")}</Button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{tn(info.devices, "{n} appareil abonné en tout.", "{n} appareils abonnés en tout.")}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-1">
              <CardTitle>{t("Ce qui est signalé")}</CardTitle>
              <div className="mt-2 grid gap-1">
                {KINDS.map((k) => (
                  <SwitchRow key={k.key} label={t(k.label)} description={t(k.hint)} checked={info.preferences[k.key]} disabled={busy}
                    onCheckedChange={(value) => void setPreference(k.key, value)} />
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  );
}
