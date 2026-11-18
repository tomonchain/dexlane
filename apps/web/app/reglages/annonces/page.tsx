"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PhotoStyleEditor, TemplateEditor } from "@/components/listings";
import { Spinner } from "@/components/ui/misc";
import { SegmentedTabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
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
    <div className="grid gap-4">
      <Link href="/reglages" className="flex items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
        <ArrowLeft className="size-3.5" aria-hidden /> Réglages
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Modèle d'annonce et photos</h1>
      <div>
        <SegmentedTabs label="Réglages des annonces" value={tab} onChange={setTab} tabs={[{ value: "TEMPLATE", label: "Modèle" }, { value: "PHOTOS", label: "Photos" }]} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!settings ? !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> Chargement…</p>
        : tab === "TEMPLATE" ? <TemplateEditor settings={settings} onSaved={setSettings} />
        : <PhotoStyleEditor settings={settings} onSaved={setSettings} />}
    </div>
  );
}
