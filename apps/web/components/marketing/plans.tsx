import { Check, Minus } from "lucide-react";
import { PRICING } from "@/components/landing/content";
import {
  FEATURED_BADGE, PLANS, PLAN_FEATURES, formatCards, formatPlanPrice, formatPricePerCard, formatWeeklyPace, planIncrement, type Plan,
} from "@/config/plans";
import { SIGNUP_OPEN, SIGNUP_URL } from "@/config/site";

/** Inscriptions fermées : chaque forfait mène à la liste d'attente, avec le forfait choisi (#103). */
const WAITLIST_BUTTON = "Rejoindre la liste d'attente";
import { cn } from "@/lib/utils";
import { Cta } from "./ui";

const featureLabel = (id: string) => PLAN_FEATURES.find((f) => f.id === id)?.label ?? id;

/** Grille courte : ce que le forfait ajoute au précédent (« Tout Solo, plus : »), ou tout ce qu'il inclut s'il est le premier. */
function Increment({ plan }: { plan: Plan }) {
  const { previous, added } = planIncrement(plan);
  return (
    <div className="grid content-start gap-2.5">
      <p className="text-[13px] font-medium">{previous ? PRICING.includesAll.replace("{plan}", previous.name) : PRICING.includes}</p>
      <ul className="grid gap-2 text-sm">
        {added.map((id) => (
          <li key={id} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            {featureLabel(id)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Toutes les lignes de la grille, incluses ou non (page /tarifs). */
function FullList({ plan }: { plan: Plan }) {
  return (
    <ul className="mb-1 grid content-start gap-2 text-sm">
      {PLAN_FEATURES.map((feature) => {
        const included = plan.features.includes(feature.id);
        return (
          <li key={feature.id} className={cn("flex items-start gap-2", !included && "text-muted-foreground/70")}>
            {included
              ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Inclus" />
              : <Minus className="mt-0.5 size-4 shrink-0" aria-label="Non inclus" />}
            {feature.label}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Grille des forfaits, lue dans config/plans.ts. Sur la landing : nom, accroche, prix, quota et son rythme, ce que le
 * forfait ajoute au précédent. Sur /tarifs : toutes les fonctionnalités, incluses ou non. Sur mobile, les forfaits
 * s'empilent en cartes.
 */
export function PlanGrid({ detailed, headingLevel = 3 }: { detailed?: boolean; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-4 lg:gap-y-0">
      {PLANS.map((plan) => {
        const perCard = formatPricePerCard(plan);
        return (
          <li
            key={plan.id}
            data-testid={`plan-${plan.id}`}
            className={cn(
              // Sur ordinateur, les rangées des quatre cartes sont alignées (sous-grille) : une accroche sur deux lignes ne décale rien.
              "relative grid grid-rows-[auto_auto_auto_1fr_auto] gap-5 rounded-2xl lg:row-span-5 lg:grid-rows-subgrid bg-background p-6 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)] dark:shadow-[0_0_0_1px_rgb(255_255_255/0.08)]",
              plan.featured && "bg-card shadow-[0_0_0_1.5px_var(--foreground),0_24px_48px_-24px_rgb(0_0_0/0.35)] dark:shadow-[0_0_0_1.5px_var(--foreground)]",
            )}
          >
            {plan.featured && (
              <span className="absolute -top-3 left-6 rounded-md bg-foreground px-2 py-0.5 text-xs font-medium text-background">{FEATURED_BADGE}</span>
            )}
            <div className="grid content-start gap-1">
              <Heading className="text-lg font-medium tracking-[-0.015em]">{plan.name}</Heading>
              <p className="text-sm text-muted-foreground">{plan.pitch}</p>
            </div>
            <p className="text-[2rem] leading-none font-[450] tracking-[-0.03em]">{formatPlanPrice(plan)}</p>
            <div className="grid content-start gap-0.5 border-y py-3">
              <p className="grid gap-0.5">
                <span className="tabular text-xl font-[450] tracking-[-0.02em]">{formatCards(plan.cardsPerMonth)}</span>
                <span className="text-[13px] text-muted-foreground">{PRICING.quotaLabel}</span>
              </p>
              <p className="tabular mt-1.5 grid text-[13px] text-muted-foreground">
                <span>{formatWeeklyPace(plan)}</span>
                {perCard && <span>{perCard}</span>}
                <span>{formatCards(plan.scansPerMonth)} {PRICING.scansLabel}</span>
              </p>
            </div>
            {detailed ? <FullList plan={plan} /> : <Increment plan={plan} />}
            <Cta href={`${SIGNUP_URL}?plan=${plan.id}`} size="md" tone={plan.featured ? "ink" : "paper"} className="w-full self-end">{SIGNUP_OPEN ? plan.button : WAITLIST_BUTTON}</Cta>
          </li>
        );
      })}
    </ul>
  );
}

/** Les trois lignes sous la grille. */
export function PlanNotes() {
  return (
    <ul className="grid gap-2 text-sm text-muted-foreground">
      {PRICING.notes.map((note) => <li key={note} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0" aria-hidden />{note}</li>)}
    </ul>
  );
}
