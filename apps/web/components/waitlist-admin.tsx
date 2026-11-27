"use client";

import { ChevronRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { t, tn } from "@/lib/i18n";

/** Dans Réglages, pour les administrateurs de l'installation : la liste d'attente des inscriptions (#103). */
export function WaitlistRow() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    api.account().then((a) => {
      if (a.role !== "admin") return;
      api.raw<{ entries: unknown[] }>("GET", "/admin/waitlist").then((w) => setCount(w.entries.length)).catch(() => undefined);
    }).catch(() => undefined);
  }, []);
  if (count === null) return null;
  return (
    <Link href="/settings/waitlist" className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent" data-testid="waitlist-row">
      <ListChecks className="size-4 text-muted-foreground" aria-hidden />
      <span className="grid flex-1">
        <span className="text-sm font-medium">{t("Liste d'attente")}</span>
        <span className="text-[13px] text-muted-foreground">{tn(count, "{n} vendeur en attente de l'ouverture des inscriptions", "{n} vendeurs en attente de l'ouverture des inscriptions")}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}
