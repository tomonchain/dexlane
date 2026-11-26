import type { Db } from "@dexlane/db";
import { getEbaySettings } from "@dexlane/listings";
import { onboardingSteps, onboardingStockTarget, type OnboardingStepDef } from "./config/progression";
import { countedOrder } from "./sql";

/**
 * Parcours de démarrage (#84) : sept étapes jusqu'à la première vente, détectées d'après les données (jamais cochées
 * à la main). Un compte existant voit donc tout de suite son avancement réel.
 */

export interface OnboardingStep extends OnboardingStepDef {
  done: boolean;
}

export interface OnboardingState {
  steps: OnboardingStep[];
  done: number;
  total: number;
  /** « Compte configuré à x % ». */
  percent: number;
  /** La première étape qui reste à faire. */
  next: OnboardingStep | null;
  complete: boolean;
}

export async function onboardingState(sql: Db): Promise<OnboardingState> {
  const [facts] = await sql<{ ebay: boolean; cardsAdded: number; listed: boolean; inStock: number; unlocated: number; sold: boolean; slip: boolean }[]>`
    select exists (select 1 from channel_accounts where channel = 'ebay') as ebay,
           (select coalesce(sum(m.qty_delta), 0)::int from inventory_movements m join stock_items s on s.id = m.stock_item_id
             where s.kind <> 'BULK' and m.bucket = 'on_hand' and m.qty_delta > 0 and m.movement_type in ('RECEIVE', 'BULK_EXTRACT')) as cards_added,
           exists (select 1 from listings where not simulated) as listed,
           (select coalesce(sum(on_hand), 0)::int from stock_items where kind <> 'BULK' and lifecycle <> 'ARCHIVED' and on_hand > 0) as in_stock,
           (select count(*)::int from stock_items where kind <> 'BULK' and lifecycle <> 'ARCHIVED' and on_hand > 0 and location_id is null) as unlocated,
           exists (select 1 from orders o where ${countedOrder(sql)}) as sold,
           exists (select 1 from orders where slip_printed_at is not null)
             or exists (select 1 from account_events where type = 'slip_printed') as slip`;
  const ebay = await getEbaySettings(sql);
  const f = facts!;
  const done: Record<OnboardingStepDef["id"], boolean> = {
    ebay: f.ebay,
    policies: f.ebay && !!(ebay.fulfillmentPolicyId && ebay.paymentPolicyId && ebay.returnPolicyId),
    stock: f.cardsAdded >= onboardingStockTarget,
    listing: f.listed,
    // Chaque position de stock a un emplacement (la base l'exige) : l'étape est faite dès qu'il y a des cartes en stock
    // et qu'aucune n'est sans emplacement.
    locations: f.inStock > 0 && f.unlocated === 0,
    sale: f.sold,
    slip: f.slip,
  };
  const steps = onboardingSteps.map((s) => ({ ...s, done: done[s.id] }));
  const count = steps.filter((s) => s.done).length;
  return {
    steps, done: count, total: steps.length, percent: Math.round((count / steps.length) * 100),
    next: steps.find((s) => !s.done) ?? null, complete: count === steps.length,
  };
}
