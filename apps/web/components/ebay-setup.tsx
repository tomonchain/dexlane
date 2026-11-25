"use client";

import { ExternalLink, LogOut, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { ApiError, api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { EbayAccountOptions, EbayConnection, EbaySettings, EbayShippingService } from "@/lib/types";

const ERRORS: Record<string, string> = {
  EBAY_BAD_CREDENTIALS: "eBay refuse les clés de l'application : vérifiez EBAY_CLIENT_ID, EBAY_CLIENT_SECRET et EBAY_ENV sur le serveur.",
  EBAY_NOT_CONNECTED: "L'autorisation du compte eBay a expiré ou a été retirée : reconnectez le compte.",
  EBAY_UNAVAILABLE: "eBay ne répond pas pour l'instant. Réessayez dans quelques minutes.",
};
export const ebayMessage = (e: unknown) => (e instanceof ApiError && ERRORS[e.code] ? t(ERRORS[e.code]!) : (e as Error).message);

const MISSING: Record<string, string> = {
  FULFILLMENT_POLICY: "règle d'envoi",
  PAYMENT_POLICY: "règle de paiement",
  RETURN_POLICY: "règle de retour",
  LOCATION: "lieu d'expédition",
};

type PolicyKey = "fulfillmentPolicyId" | "paymentPolicyId" | "returnPolicyId";
const POLICIES: { key: PolicyKey; label: string; list: keyof Pick<EbayAccountOptions, "fulfillmentPolicies" | "paymentPolicies" | "returnPolicies"> }[] = [
  { key: "fulfillmentPolicyId", label: "Règle d'envoi", list: "fulfillmentPolicies" },
  { key: "paymentPolicyId", label: "Règle de paiement", list: "paymentPolicies" },
  { key: "returnPolicyId", label: "Règle de retour", list: "returnPolicies" },
];

/**
 * Connexion du compte eBay et réglages du canal : le site, les règles de vente et le lieu d'expédition. Ce qui manque
 * peut être créé d'ici, avec des valeurs simples, puis ajusté sur eBay.
 */
export function EbaySetup({ onChanged }: { onChanged: () => void }) {
  const [connection, setConnection] = useState<EbayConnection | null>(null);
  const [options, setOptions] = useState<EbayAccountOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(() => {
    setOptions(null);
    api.ebayOptions().then(setOptions).catch((e: unknown) => setError(ebayMessage(e)));
  }, []);

  useEffect(() => {
    api.ebayConnection().then((c) => {
      setConnection(c);
      if (c.configured && c.account) loadOptions();
    }).catch((e: unknown) => setError(ebayMessage(e)));
  }, [loadOptions]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(ebayMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const applied = (next: EbayConnection) => {
    setConnection(next);
    onChanged();
  };

  if (!connection) return error ? <Alert variant="destructive">{error}</Alert> : <div className="flex justify-center py-2"><Spinner /></div>;
  if (!connection.configured) return null;

  const sandbox = connection.environment === "sandbox";
  const connect = () => run(async () => {
    window.location.assign((await api.ebayConnect()).url);
  });
  const disconnect = () => run(async () => {
    if (!window.confirm(t("Déconnecter le compte eBay ? Les annonces restent en ligne sur eBay, mais Dexlane ne les suivra plus."))) return;
    applied(await api.ebayDisconnect());
    setOptions(null);
    toast.success(t("Compte eBay déconnecté"));
  });
  const save = (change: Partial<EbaySettings>) => run(async () => {
    applied(await api.saveEbaySettings(change));
    if (change.marketplaceId) loadOptions();
  });

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 text-sm" data-testid="ebay-setup">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t("Compte eBay")}</span>
        {sandbox && <Badge variant="warning">{t("Bac à sable")}</Badge>}
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}

      {!connection.account ? (
        <>
          <p className="text-muted-foreground">
            {sandbox
              ? t("Connectez-vous avec un utilisateur de test du bac à sable pour autoriser Dexlane à publier et à lire les commandes.")
              : t("Autorisez Dexlane à publier vos annonces et à lire vos commandes sur eBay.")}
          </p>
          <Button onClick={connect} disabled={busy} className="justify-self-start">{busy ? <Spinner /> : <ExternalLink />} {t("Connecter le compte eBay")}</Button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {t("Connecté")}{connection.account.username && <> : <strong>{connection.account.username}</strong></>}
              <span className="text-muted-foreground"> · {t("depuis le {date}", { date: formatDateTime(connection.account.connectedAt) })}</span>
            </p>
            <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy}><LogOut /> {t("Déconnecter")}</Button>
          </div>

          <Field label={t("Site eBay")}>
            <Select value={connection.settings.marketplaceId} disabled={busy} onChange={(e) => save({ marketplaceId: e.target.value as EbaySettings["marketplaceId"] })}>
              {connection.marketplaces.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </Select>
          </Field>

          {!options ? <div className="flex justify-center py-2"><Spinner /></div> : (
            <>
              {POLICIES.map((p) => (
                <Field key={p.key} label={t(p.label)}>
                  <Select value={connection.settings[p.key] ?? ""} disabled={busy} onChange={(e) => save({ [p.key]: e.target.value || null })}>
                    <option value="">{t("— À choisir —")}</option>
                    {options[p.list].map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                </Field>
              ))}
              <Field label={t("Lieu d'expédition")}>
                <Select value={connection.settings.merchantLocationKey ?? ""} disabled={busy} onChange={(e) => save({ merchantLocationKey: e.target.value || null })}>
                  <option value="">{t("— À choisir —")}</option>
                  {options.locations.filter((l) => l.enabled).map((l) => (
                    <option key={l.key} value={l.key}>{[l.name ?? l.key, [l.postalCode, l.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {connection.missing.length === 0 ? (
            <Alert variant="success">{t("Tout est prêt : vous pouvez passer eBay en réel.")}</Alert>
          ) : (
            <MissingSetup connection={connection} busy={busy} run={run} onDone={(next) => { applied(next); loadOptions(); }} />
          )}
        </>
      )}
    </div>
  );
}

function MissingSetup({ connection, busy, run, onDone }: {
  connection: EbayConnection;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onDone: (next: EbayConnection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<EbayShippingService[] | null>(null);
  const [service, setService] = useState("");
  const [cost, setCost] = useState("2.50");
  const [handlingDays, setHandlingDays] = useState(2);
  const [returnDays, setReturnDays] = useState<14 | 30 | 60>(30);
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const needs = new Set(connection.missing);

  const start = () => run(async () => {
    setOpen(true);
    if (needs.has("FULFILLMENT_POLICY") && !services) {
      const list = (await api.ebayShippingServices()).services;
      setServices(list);
      setService(list.find((s) => /lettre.*suivi|tracked letter/i.test(s.description))?.code ?? list[0]?.code ?? "");
    }
  });
  const create = () => run(async () => {
    const cents = Math.round(Number(cost.replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 0) throw new Error(t("Frais de port invalides."));
    onDone(await api.createEbayDefaults({ shippingServiceCode: service || "-", shippingCostCents: cents, handlingDays, returnDays, postalCode, city }));
    setOpen(false);
    toast.success(t("Réglages eBay créés"));
  });

  return (
    <div className="grid gap-3 rounded-lg bg-muted/40 p-3">
      <p className="text-muted-foreground">
        {t("Pour publier, il manque : {list}.", { list: connection.missing.map((m) => t(MISSING[m] ?? m)).join(", ") })}
        {" "}{t("Choisissez-les ci-dessus, ou laissez Dexlane les créer sur votre compte eBay.")}
      </p>
      {!open ? (
        <Button variant="outline" onClick={start} disabled={busy} className="justify-self-start">{busy ? <Spinner /> : <Wand2 />} {t("Créer ce qui manque")}</Button>
      ) : (
        <div className="grid gap-3">
          {needs.has("FULFILLMENT_POLICY") && (
            <>
              <Field label={t("Service d'envoi")} hint={t("Proposé aux acheteurs pour toutes vos annonces ; modifiable ensuite sur eBay.")}>
                <Select value={service} onChange={(e) => setService(e.target.value)} disabled={busy || !services}>
                  {(services ?? []).map((s) => <option key={s.code} value={s.code}>{s.description}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("Frais de port (€)")}><Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
                <Field label={t("Délai d'expédition (jours)")}>
                  <Select value={handlingDays} onChange={(e) => setHandlingDays(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </Field>
              </div>
            </>
          )}
          {needs.has("RETURN_POLICY") && (
            <Field label={t("Retours acceptés")} hint={t("14 jours au minimum pour un vendeur professionnel dans l'Union européenne. Frais de retour à la charge de l'acheteur.")}>
              <Select value={returnDays} onChange={(e) => setReturnDays(Number(e.target.value) as 14 | 30 | 60)}>
                {[14, 30, 60].map((d) => <option key={d} value={d}>{t("{n} jours", { n: d })}</option>)}
              </Select>
            </Field>
          )}
          {needs.has("LOCATION") && (
            <div className="grid grid-cols-[8rem_1fr] gap-3">
              <Field label={t("Code postal")}><Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" /></Field>
              <Field label={t("Ville d'expédition")}><Input value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" /></Field>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={create} disabled={busy}>{busy ? <Spinner /> : <Wand2 />} {t("Créer sur eBay")}</Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("Annuler")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
