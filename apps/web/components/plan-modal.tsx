"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api";
import { dayLabel, formatNumber } from "@/lib/format";
import { t, tn } from "@/lib/i18n";
import type { ChannelId, ChannelState } from "@/lib/types";
import { composeMissingVisuals } from "@/lib/visuals";
import { Button } from "./ui/button";
import { Field, Input, Select } from "./ui/input";
import { Spinner } from "./ui/misc";
import { Modal } from "./ui/modal";

const message = (e: unknown) => (e instanceof ApiError && e.code === "CHANNEL_DISABLED" ? t("Ce canal est désactivé.") : (e as Error).message);

/**
 * Répartit des cartes sur des jours de mise en ligne. `selected` vide : toutes les cartes prêtes.
 * Les visuels d'annonce manquants sont composés au passage : la tâche quotidienne n'a plus qu'à publier.
 */
export function PlanModal({ channels, selected, readyCount, scope, onClose, onPlanned }: {
  channels: ChannelState[];
  selected: string[];
  readyCount: number;
  /** Ce que désigne la sélection, pour le sous-titre (« les 98 cartes de ce lot »). */
  scope?: string;
  onClose: () => void;
  onPlanned: () => void;
}) {
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return new Intl.DateTimeFormat("en-CA").format(d);
  })();
  const [channel, setChannel] = useState<ChannelId>(channels[0]!.id);
  const [startOn, setStartOn] = useState(tomorrow);
  const [perDay, setPerDay] = useState("10");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = selected.length || readyCount;
  const pace = Number(perDay);
  const valid = Number.isInteger(pace) && pace >= 1 && pace <= 500 && !!startOn;
  const days = valid ? Math.ceil(count / pace) : 0;
  const last = (() => {
    if (!valid || days === 0) return null;
    const d = new Date(`${startOn}T12:00:00`);
    d.setDate(d.getDate() + days - 1);
    return new Intl.DateTimeFormat("en-CA").format(d);
  })();

  async function plan() {
    setBusy(true);
    setError(null);
    try {
      const offerIds = selected.length ? selected : (await api.stock({ status: "READY", limit: 200 })).items.map((row) => row.offerId);
      await composeMissingVisuals(offerIds, (done, total) => setPreparing({ done, total })).catch(() => 0);
      setPreparing(null);
      const r = await api.planPublications({ offerIds: selected.length ? selected : undefined, channel, startOn, perDay: pace });
      toast.success(
        r.planned === 0 ? t("Aucune carte à planifier : elles sont déjà en ligne, sans prix ou sans stock.")
          : t("{what} sur {days}", {
            what: tn(r.planned, "{n} carte planifiée", "{n} cartes planifiées"),
            days: tn(r.days, "{n} jour", "{n} jours"),
          }) + (r.skipped ? tn(r.skipped, ", {n} laissée de côté", ", {n} laissées de côté") : ""),
      );
      onPlanned();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "INVALID_SCHEDULE" ? t("Le premier jour doit être aujourd'hui ou plus tard, avec 1 à 500 cartes par jour.") : message(e));
      setBusy(false);
      setPreparing(null);
    }
  }

  return (
    <Modal
      title={t("Planifier la mise en ligne")}
      description={scope ?? (selected.length
        ? t("Les {n} cartes sélectionnées, dans l'ordre de la sélection.", { n: formatNumber(selected.length) })
        : t("Toutes les cartes prêtes ({n}), dans l'ordre d'entrée en stock.", { n: formatNumber(readyCount) }))}
      onClose={onClose}
    >
      {channels.length > 1 && (
        <Field label={t("Canal")}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as ChannelId)}>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}{c.mode === "SIMULATION" ? t(" (simulation)") : ""}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("À partir du")}><Input type="date" value={startOn} onChange={(e) => setStartOn(e.target.value)} /></Field>
        <Field label={t("Cartes par jour")}><Input inputMode="numeric" value={perDay} onChange={(e) => setPerDay(e.target.value)} className="tabular" /></Field>
      </div>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="plan-summary">
        {valid && last
          ? <>
            {t("Jusqu'à")} <strong className="font-medium">{tn(count, "{n} carte", "{n} cartes")}</strong> {t("sur")}{" "}
            <strong className="font-medium">{tn(days, "{n} jour", "{n} jours")}</strong>,{" "}
            {days > 1 ? t("du {from} au {to}", { from: dayLabel(startOn), to: dayLabel(last) }) : t("le {day}", { day: dayLabel(startOn) })}.{" "}
            {t("Publication chaque matin.")}
          </>
          : t("Indiquez une date et un nombre de cartes par jour.")}
      </p>
      <p className="text-[13px] text-muted-foreground">{t("Les cartes déjà en ligne sur ce canal, sans prix ou sans stock vendable sont laissées de côté.")}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button size="lg" onClick={plan} disabled={busy || !valid}>
        {busy ? <Spinner className="text-primary-foreground" /> : <CalendarClock />}{" "}
        {preparing ? t("Préparation des photos {done} / {total}…", { done: preparing.done, total: preparing.total }) : t("Planifier")}
      </Button>
    </Modal>
  );
}
