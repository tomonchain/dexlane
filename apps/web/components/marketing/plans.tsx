import { Check, Minus } from "lucide-react";
import { PRICING } from "@/components/landing/content";
import { FEATURED_BADGE, PLANS, PLAN_FEATURES, formatCards, formatPlanPrice } from "@/config/plans";
import { SIGNUP_URL } from "@/config/site";
import { cn } from "@/lib/utils";
import { Cta } from "./ui";

/**
 * Grille des forfaits, lue dans config/plans.ts. Version courte sur la landing (nom, accroche, prix, quota, bouton),
 * complète sur /tarifs (avec les fonctionnalités). Sur mobile, les forfaits s'empilent en cartes.
 */
export function PlanGrid({ detailed, headingLevel = 3 }: { detailed?: boolean; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {PLANS.map((plan) => (
        <li
          key={plan.id}
          data-testid={`plan-${plan.id}`}
          className={cn(
            "relative flex flex-col gap-5 rounded-2xl bg-background p-6 shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.04)]",
            plan.featured && "bg-card shadow-[0_0_0_1.5px_var(--foreground),0_24px_48px_-24px_rgb(0_0_0/0.35)]",
          )}
        >
          {plan.featured && (
            <span className="absolute -top-3 left-6 rounded-md bg-foreground px-2 py-0.5 text-xs font-medium text-background">{FEATURED_BADGE}</span>
          )}
          <div className="grid gap-1">
            <Heading className="text-lg font-medium tracking-[-0.015em]">{plan.name}</Heading>
            <p className="text-sm text-muted-foreground">{plan.pitch}</p>
          </div>
          <p className="text-[2rem] leading-none font-[450] tracking-[-0.03em]">{formatPlanPrice(plan)}</p>
          <p className={cn("grid gap-0.5 border-t pt-3", detailed && "border-b pb-3")}>
            <span className="tabular text-xl font-[450] tracking-[-0.02em]">{formatCards(plan.cardsPerMonth)}</span>
            <span className="text-[13px] text-muted-foreground">{PRICING.quotaLabel}</span>
          </p>
          {detailed && (
            <ul className="mb-1 grid gap-2 text-sm">
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
          )}
          <Cta href={SIGNUP_URL} size="md" tone={plan.featured ? "ink" : "paper"} className="mt-auto w-full">{plan.button}</Cta>
        </li>
      ))}
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
