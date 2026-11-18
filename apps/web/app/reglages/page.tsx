import { Archive, BookOpen, Boxes, ChartColumn, ChevronRight, CircleUserRound, Megaphone, Sparkles, Store, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";

const SECTIONS: { title: string; items: { href: string; label: string; hint: string; icon: LucideIcon }[] }[] = [
  {
    title: "Vendre",
    items: [
      { href: "/prix", label: "Règles de prix", hint: "Seuils de catégorie, arrondis, coefficients d'état, file de revue", icon: Tags },
      { href: "/reglages/annonces", label: "Modèle d'annonce et photos", hint: "Titre, description, fond des photos, image de fin d'annonce", icon: Megaphone },
      { href: "/reglages/canaux", label: "Canaux de vente", hint: "eBay et CardTrader : désactivé, simulation ou réel", icon: Store },
    ],
  },
  {
    title: "Ranger",
    items: [
      { href: "/rangement", label: "Emplacements", hint: "Boîtes, classeurs, lots d'acquisition", icon: Archive },
      { href: "/inventaire", label: "Positions physiques", hint: "Chaque position par code, pour retrouver ou corriger un exemplaire", icon: Boxes },
    ],
  },
  {
    title: "Application",
    items: [
      { href: "/catalogue", label: "Catalogue", hint: "Séries importées et cotations", icon: BookOpen },
      { href: "/statistiques", label: "Tableau de bord", hint: "Valeur du stock, ventes, variations de prix", icon: ChartColumn },
      { href: "/bienvenue", label: "Assistant de démarrage", hint: "Revoir les étapes : mode de scan, séries, emplacements, prix, canaux", icon: Sparkles },
      { href: "/compte", label: "Compte", hint: "Mot de passe, thème, déconnexion", icon: CircleUserRound },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader title="Réglages" />
      {SECTIONS.map((section) => (
        <section key={section.title} className="grid gap-2">
          <h2 className="px-1 text-xs font-medium text-muted-foreground">{section.title}</h2>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent">
                <item.icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="grid flex-1">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-[13px] text-muted-foreground">{item.hint}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
