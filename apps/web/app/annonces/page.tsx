"use client";

import { useEffect, useState } from "react";
import { Offers } from "@/components/listings";
import { Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { ChannelState, ListingSettings } from "@/lib/types";

/** Les annonces prêtes : texte et photos de chaque carte à vendre, publication sur les canaux activés. */
export default function ListingsPage() {
  const [settings, setSettings] = useState<ListingSettings | null>(null);
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listingSettings().then(setSettings).catch((e: Error) => setError(e.message));
    api.channels().then((r) => setChannels(r.channels.filter((c) => c.mode !== "OFF"))).catch(() => setChannels([]));
  }, []);

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Annonces</h1>
        <p className="text-sm text-muted-foreground">Le texte et les photos de chaque carte à vendre, prêts à copier ou à publier.</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {settings ? <Offers settings={settings} channels={channels} /> : !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Spinner /> Chargement…</p>}
    </div>
  );
}
