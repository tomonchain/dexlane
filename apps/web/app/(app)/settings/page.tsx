"use client";

import { Archive, Bot, CreditCard, LifeBuoy, Package, PackageOpen, Users, BellDot, BellRing, BookOpen, Boxes, ChevronRight, CircleUserRound, Mail, Megaphone, Printer, ScanLine, Sparkles, Store, Tags, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ExportStockRow } from "@/components/export-stock";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/misc";
import { t } from "@/lib/i18n";
import { GITHUB_URL } from "@/config/site";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION;
const COMMIT = process.env.NEXT_PUBLIC_APP_COMMIT;

const SECTIONS: { title: string; items: { href: string; label: string; hint: string; icon: LucideIcon }[]; extra?: ReactNode }[] = [
  {
    title: "Vendre",
    items: [
      { href: "/pricing", label: "Règles de prix", hint: "Seuils de catégorie, arrondis, coefficients d'état, file de revue", icon: Tags },
      { href: "/settings/listing", label: "Modèle d'annonce et photos", hint: "Titre, description, fond des photos, image de fin d'annonce", icon: Megaphone },
      { href: "/settings/channels", label: "Canaux de vente", hint: "eBay et CardTrader : désactivé, simulation ou réel", icon: Store },
      { href: "/lots", label: "Lots de vente", hint: "Des cartes vendues ensemble, en une seule annonce", icon: Package },
      { href: "/settings/alerts", label: "Alertes de prix", hint: "À partir de quelle variation de cote une carte t'est signalée", icon: BellRing },
    ],
  },
  {
    title: "Expédier",
    items: [
      { href: "/settings/shop", label: "Boutique et documents", hint: "Nom, adresse et mention légale des bons et reçus, format de l'imprimante", icon: Printer },
      { href: "/stock?section=supplies", label: "Fournitures", hint: "Stock de sleeves, top-loaders et enveloppes, seuils de commande", icon: PackageOpen },
      { href: "/settings/shipping", label: "Frais d'envoi", hint: "Affranchissement, sleeve, top-loader, enveloppe : déduits de la marge", icon: Mail },
    ],
  },
  {
    title: "Ranger",
    items: [
      { href: "/settings/intake", label: "Saisie des cartes", hint: "Scanner à défilement, appareil photo ou fichiers", icon: ScanLine },
      { href: "/locations", label: "Emplacements", hint: "Boîtes, classeurs, lots d'acquisition", icon: Archive },
      { href: "/inventory", label: "Positions physiques", hint: "Chaque position par code, pour retrouver ou corriger un exemplaire", icon: Boxes },
    ],
  },
  {
    title: "Compte et forfait",
    items: [
      { href: "/settings/plan", label: "Forfait", hint: "Cartes publiées ce mois-ci, packs, changement de forfait", icon: CreditCard },
      { href: "/settings/team", label: "Équipe", hint: "Inviter les personnes qui travaillent avec toi", icon: Users },
      { href: "/settings/support", label: "Support", hint: "Une question, un bug, une idée : écrire au support", icon: LifeBuoy },
    ],
  },
  {
    title: "Application",
    items: [
      { href: "/catalog", label: "Catalogue", hint: "Séries importées et cotations", icon: BookOpen },
      { href: "/welcome", label: "Assistant de démarrage", hint: "Revoir les étapes : mode de scan, séries, emplacements, prix, canaux", icon: Sparkles },
      { href: "/settings/notifications", label: "Notifications", hint: "Résumé du matin sur ton téléphone : ventes, cartes suivies, mises en ligne, fournitures", icon: BellDot },
      { href: "/settings/agents", label: "Agents (MCP)", hint: "Jetons d'accès pour laisser des agents gérer la boutique", icon: Bot },
      { href: "/account", label: "Compte", hint: "Mot de passe, thème, déconnexion", icon: CircleUserRound },
    ],
    extra: <ExportStockRow />,
  },
];

export default function SettingsPage() {
  return (
    <Page width="narrow" className="mx-auto w-full gap-6">
      <PageHeader title={t("Réglages")} />
      {SECTIONS.map((section) => (
        <section key={section.title} className="grid gap-2">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">{t(section.title)}</h2>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <item.icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="grid flex-1">
                  <span className="text-sm font-medium">{t(item.label)}</span>
                  <span className="text-[13px] text-muted-foreground">{t(item.hint)}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
            {section.extra}
          </div>
        </section>
      ))}
      {VERSION && (
        <p className="px-1 text-center text-xs text-muted-foreground">
          <a href={`${GITHUB_URL}/releases/tag/v${VERSION}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
            dexlane v{VERSION}
          </a>
          {COMMIT && <span className="font-mono"> · {COMMIT}</span>}
        </p>
      )}
    </Page>
  );
}
