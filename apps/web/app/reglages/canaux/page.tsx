"use client";

import { useEffect, useState } from "react";
import { Channels } from "@/components/listings";
import { BackLink, Page, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { ChannelState } from "@/lib/types";

export default function ChannelSettingsPage() {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.channels().then((r) => setChannels(r.channels)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Page>
      <PageHeader back={<BackLink href="/reglages">Réglages</BackLink>} title="Canaux de vente" description="Pour chaque marketplace : désactivé, en simulation pour tout essayer sans rien publier, ou réel." />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Channels channels={channels} onChange={setChannels} />
    </Page>
  );
}
