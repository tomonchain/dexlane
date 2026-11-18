import { ArrowRight, CalendarClock, Camera, ScanLine, ShieldCheck, Tags } from "lucide-react";
import Link from "next/link";
import { Logo } from "./app-shell";
import { Button } from "./ui/button";

const STEPS = [
  { n: "1", title: "Scannez la pile", text: "Un lot au scanner à défilement, ou au téléphone recto puis verso. Chaque carte est reconnue et prend son rang." },
  { n: "2", title: "Corrigez l'essentiel", text: "Les lectures sûres sont déjà remplies. Vous ne revoyez que les cartes signalées, dans l'ordre du scan." },
  { n: "3", title: "Le prix se pose", text: "À partir des cotes Cardmarket, selon votre stratégie, et jamais sous votre prix d'achat." },
  { n: "4", title: "Planifiez la mise en ligne", text: "Tant de cartes par jour, avec vos photos mises en scène et votre image de fin d'annonce." },
];

const FEATURES = [
  { icon: ScanLine, title: "L'ordre de la boîte", text: "Les codes suivent l'ordre du scan : le jour de la vente, la carte se retrouve à son rang dans sa boîte." },
  { icon: Tags, title: "Des prix explicables", text: "Vendre vite, équilibré ou marge maximale. Chaque prix montre la cote dont il vient et sa date." },
  { icon: Camera, title: "Des photos prêtes", text: "Le scan devient un visuel carré sur le fond de votre choix. Une photo manquante s'ajoute après coup." },
  { icon: CalendarClock, title: "Une mise en ligne étalée", text: "Le planning publie chaque matin ce qui est dû et signale ce qui n'a pas pu partir." },
  { icon: ShieldCheck, title: "Pas de double vente", text: "Une carte vendue quelque part est retirée partout. Le stock réservé ne peut pas être revendu." },
];

/** Aperçu stylisé de l'écran Stock : une illustration, pas des données réelles. */
function StockPreview() {
  const rows = [
    ["Dracaufeu", "Set de Base · 4 · Holo", "EX", "250,00 €", "En ligne", "bg-success"],
    ["Mew-ex", "151 · 151 · Holo", "NM", "38,00 €", "Planifiée mer. 19", "bg-foreground/35"],
    ["Pikachu", "Ténèbres Embrasées · 65 · Reverse", "NM", "4,20 €", "Prête", "bg-foreground/35"],
    ["Fouinar", "Ténèbres Embrasées · 136 · Normale", "GD", "0,45 €", "À tarifer", "bg-brand"],
  ] as const;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/5" aria-hidden>
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" /><span className="size-2.5 rounded-full bg-border" />
        <span className="ml-3 text-xs font-medium text-muted-foreground">Stock · 1 248 cartes · 6 430,00 €</span>
      </div>
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([name, detail, condition, price, status, dot]) => (
            <tr key={name} className="border-b last:border-b-0">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-3">
                  <span className="aspect-[63/88] w-7 rounded-[3px] bg-muted ring-1 ring-border" />
                  <span className="grid">
                    <span className="font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">{detail}</span>
                  </span>
                </span>
              </td>
              <td className="hidden px-3 font-mono text-xs sm:table-cell">{condition}</td>
              <td className="tabular px-3 text-right font-medium whitespace-nowrap">{price}</td>
              <td className="hidden px-4 text-[13px] whitespace-nowrap sm:table-cell">
                <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${dot}`} />{status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Page de présentation publique : ce que fait Dexlane, sans rien promettre qui n'existe pas. */
export function Landing() {
  return (
    <div className="mx-auto grid max-w-5xl gap-20 px-5 pt-6 pb-16 sm:gap-24 sm:px-8">
      <header className="flex items-center justify-between">
        <Logo />
        <Button asChild variant="outline" size="sm"><Link href="/login">Se connecter</Link></Button>
      </header>

      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid gap-5">
          <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">Du carton de cartes à l'annonce en ligne.</h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            Dexlane transforme une pile de cartes Pokémon en stock rangé, tarifé et prêt à vendre. Vous scannez, vous corrigez l'essentiel, la mise en ligne s'étale toute seule.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg"><Link href="/login">Ouvrir Dexlane <ArrowRight /></Link></Button>
            <Button asChild size="lg" variant="ghost"><a href="#parcours">Voir le parcours</a></Button>
          </div>
        </div>
        <StockPreview />
      </section>

      <section id="parcours" className="grid scroll-mt-8 gap-8">
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Le parcours</p>
          <h2 className="text-2xl font-semibold tracking-tight">Quatre gestes, dans l'ordre.</h2>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <li key={step.n} className="grid content-start gap-2 bg-card p-5">
              <span className="tabular flex size-7 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold">{step.n}</span>
              <h3 className="text-[15px] font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-8">
        <div className="grid gap-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ce qui compte</p>
          <h2 className="text-2xl font-semibold tracking-tight">Pensé pour vendre, pas pour collectionner.</h2>
        </div>
        <ul className="grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="grid content-start gap-1.5">
              <feature.icon className="size-5 text-muted-foreground" aria-hidden />
              <h3 className="mt-1 text-[15px] font-semibold">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
            </li>
          ))}
        </ul>
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Canaux de vente : eBay et CardTrader sont prévus. Aujourd'hui, la mise en ligne tourne en simulation ; la publication réelle arrive avec le raccordement aux marketplaces.
        </p>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-[13px] text-muted-foreground">
        <span>Dexlane — stock et vente de cartes Pokémon.</span>
        <Link href="/login" className="font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:underline">Se connecter</Link>
      </footer>
    </div>
  );
}
