"use client";

import { useEffect, useState } from "react";
import { PhotoStyleEditor, TemplateEditor } from "@/components/listings";
import { BackLink, Loading, Page, PageHeader } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { ListingSettings } from "@/lib/types";

/** Réglages des annonces : le modèle de texte et la mise en scène des photos. */
export default function ListingSettingsPage() {
  const [tab, setTab] = useState<"TEMPLATE" | "PHOTOS">("TEMPLATE");
  const [settings, setSettings] = useState<ListingSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listingSettings().then(setSettings).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Page className="mx-auto w-full max-w-5xl">
      <PageHeader back={<BackLink href="/reglages">{t("Réglages")}</BackLink>} title={t("Modèle d'annonce et photos")} description={t("Le texte des annonces et la mise en scène des photos, communs à tous les canaux.")} />
      <div>
        <SegmentedTabs label={t("Réglages des annonces")} value={tab} onChange={setTab} tabs={[{ value: "TEMPLATE", label: t("Modèle") }, { value: "PHOTOS", label: t("Photos") }]} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!settings ? !error && <Loading />
        : tab === "TEMPLATE" ? <TemplateEditor settings={settings} onSaved={setSettings} />
        : <PhotoStyleEditor settings={settings} onSaved={setSettings} />}
    </Page>
  );
}
