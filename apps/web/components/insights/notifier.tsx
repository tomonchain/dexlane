"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { t, tn } from "@/lib/i18n";

interface Notifications {
  announce: { id: string; name: string }[];
  retroactive: number | null;
}

const EVERY_MS = 60_000;

/**
 * Annonce les succès débloqués : une notification dans l'application, non bloquante, groupée quand plusieurs arrivent
 * d'un coup ; jamais d'e-mail. Après l'attribution rétroactive du lancement, un message unique résume ce qui était déjà
 * acquis. Regarde au plus une fois par minute, au fil de la navigation.
 */
export function AchievementNotifier() {
  const pathname = usePathname();
  const router = useRouter();
  const last = useRef(0);
  useEffect(() => {
    if (Date.now() - last.current < EVERY_MS || pathname.startsWith("/progress")) return;
    last.current = Date.now();
    api.raw<Notifications>("GET", "/insights/notifications").then((n) => {
      const open = { label: t("Voir"), onClick: () => router.push("/progress") };
      if (n.retroactive !== null) {
        toast(tn(n.retroactive, "Tu as déjà débloqué {n} succès.", "Tu as déjà débloqué {n} succès."), {
          description: t("Voir ta progression"), action: open, duration: 10_000,
        });
        void api.raw("POST", "/insights/notifications/seen", { json: { retroMessage: true, achievements: true } }).catch(() => undefined);
        return;
      }
      if (n.announce.length === 0) return;
      const names = n.announce.map((a) => t(a.name));
      toast(n.announce.length === 1 ? t("Succès débloqué : {name}", { name: names[0]! }) : tn(n.announce.length, "{n} succès débloqué", "{n} succès débloqués"), {
        description: n.announce.length > 1 ? names.join(", ") : undefined, action: open, duration: 8_000,
      });
      void api.raw("POST", "/insights/notifications/seen", { json: { achievements: true } }).catch(() => undefined);
    }).catch(() => undefined);
  }, [pathname, router]);
  return null;
}
