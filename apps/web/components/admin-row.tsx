"use client";

import { ChevronRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EDITION } from "@/config/edition";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Dans Réglages, pour les administrateurs : l'administration du service, quand l'édition en a une (config/edition.ts). */
export function AdminRow() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!EDITION.admin) return;
    api.account().then((a) => setAdmin(a.role === "admin")).catch(() => undefined);
  }, []);
  if (!EDITION.admin || !admin) return null;
  return (
    <Link href={EDITION.admin} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent" data-testid="admin-row">
      <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
      <span className="grid flex-1">
        <span className="text-sm font-medium">{t("Administration du service")}</span>
        <span className="text-[13px] text-muted-foreground">{t("Comptes, liste d'attente et activité de tout le service")}</span>
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}
