"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Channels } from "@/components/listings";
import { api } from "@/lib/api";
import type { ChannelState } from "@/lib/types";

export default function ChannelSettingsPage() {
  const [channels, setChannels] = useState<ChannelState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.channels().then((r) => setChannels(r.channels)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="grid gap-4">
      <Link href="/reglages" className="flex items-center gap-1.5 justify-self-start text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
        <ArrowLeft className="size-3.5" aria-hidden /> Réglages
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">Canaux de vente</h1>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Channels channels={channels} onChange={setChannels} />
    </div>
  );
}
