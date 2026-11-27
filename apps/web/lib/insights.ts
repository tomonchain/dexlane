import type { AchievementCategory, AchievementRarity, OnboardingStepId } from "@dexlane/insights/config";
import { api, newKey } from "./api";
import type { Amount } from "./insights-format";

/*
 * Statistiques, cartes dormantes, parcours de démarrage, récaps, niveau et succès : les réponses de /api/insights/*
 * (dates en texte ISO) et les appels du navigateur.
 */

export type { Amount };

export type StatsPeriod = "this_month" | "last_month" | "90d" | "12m";

export interface SellerStats {
  period: { id: string; start: string; end: string; timezone: string };
  revenue: Amount[] | null;
  margin: { amounts: Amount[]; coveragePercent: number; ebayFeesMissing: boolean } | null;
  cardsSold: number | null;
  sellThroughPercent: number | null;
  medianDaysToSell: number | null;
  timeSaved: { listings: number; minutes: number; minutesPerListing: number } | null;
  weekly: { week: string; cards: number; revenue: Amount[] }[];
  topSales: { orderId: string; orderLineId: string; catalogCardId: string; name: string; setName: string | null; qty: number; unitPriceCents: number; currency: string; soldAt: string }[];
}

export interface DormantCard {
  offerId: string;
  offerSku: string;
  kind: "CARD" | "LOT";
  name: string;
  setName: string | null;
  localNumber: string;
  imageUrl: string | null;
  condition: string;
  priceCents: number;
  currency: string;
  floorPriceCents: number | null;
  listedAt: string;
  daysOnline: number;
  available: number;
  locations: string[];
  listingIds: string[];
  channels: string[];
}

export interface RepriceLine { offerId: string; name: string; beforeCents: number; afterCents: number; atFloor: boolean }

export interface OnboardingStep { id: OnboardingStepId; title: string; action: string; href: string; done: boolean }
export interface OnboardingState {
  steps: OnboardingStep[];
  done: number;
  total: number;
  percent: number;
  next: OnboardingStep | null;
  complete: boolean;
  hidden: boolean;
  completedAt?: string | null;
}

export interface LevelState {
  level: number;
  confirmedSales: number;
  next: { level: number; threshold: number; salesNeeded: number } | null;
  progressPercent: number;
}

export interface AchievementState {
  id: string;
  /** Numéro dans le classeur. */
  number: number;
  rarity: AchievementRarity;
  name: string;
  description: string;
  category: AchievementCategory;
  unlockedAt: string | null;
  source: "live" | "retroactive" | null;
}

export interface ProgressView {
  hidden: false;
  level: LevelState;
  beta: boolean;
  achievements: AchievementState[];
  recent: AchievementState[];
  unlockedCount: number;
  retroactiveCount: number;
  categories: { id: AchievementCategory; label: string }[];
  rarities: { id: AchievementRarity; label: string }[];
  levelNames: string[];
  shopName: string | null;
}

export interface HomeInsights {
  onboarding: OnboardingState;
  dormant: { count: number; remind: boolean };
  progression: {
    level: LevelState;
    announce: { id: string; name: string; category: AchievementCategory }[];
    /** Après l'attribution rétroactive : le nombre de succès à annoncer une seule fois. */
    retroactive: number | null;
  } | null;
}

export interface Preferences {
  /** L'e-mail du récap est-il proposé (il est coupé pour le moment) ? */
  recapEmailAvailable?: boolean;
  timezone: string;
  showProgression: boolean;
  recapEmail: boolean;
  onboardingHidden: boolean;
}

export interface RecapData {
  period: string;
  kind: "month" | "year";
  start: string;
  end: string;
  timezone: string;
  listingsPublished: number;
  cardsSold: number;
  revenue: Amount[];
  timeSavedMinutes: number;
  bestSale: { name: string; setName: string | null; unitPriceCents: number; currency: string; soldAt: string } | null;
  fastestSale: { name: string; setName: string | null; days: number; soldAt: string } | null;
  achievements: { id: string; name: string; unlockedAt: string }[];
  /** null quand l'utilisateur a masqué la progression. */
  level: Pick<LevelState, "level" | "next" | "progressPercent" | "confirmedSales"> | null;
  recordMonth: { month: string; cards: number } | null;
  achievementsCount: number;
}

export interface RecapView { period: string; createdAt: string; data: RecapData; showProgression: boolean; shopName: string | null; referral: { link: string } | null }
export interface RecapSummary { period: string; kind: "month" | "year"; createdAt: string; cardsSold: number }

const get = <T,>(path: string) => api.raw<T>("GET", path);
const post = <T,>(path: string, json: unknown) => api.raw<T>("POST", path, { json, idempotencyKey: newKey() });

export const insights = {
  stats: (period: StatsPeriod) => get<SellerStats>(`/insights/stats?period=${period}`),
  dormant: () => get<{ cards: DormantCard[]; afterDays: number; canBundle: boolean }>("/insights/dormant"),
  previewReprice: (offerIds: string[], percent: number) => post<{ lines: RepriceLine[] }>("/insights/dormant/preview", { offerIds, percent }),
  reprice: (offerIds: string[], percent: number) => post<{ repriced: number }>("/insights/dormant/reprice", { offerIds, percent, confirm: true }),
  bundle: (offerIds: string[], title: string, priceCents: number) => post<{ offerId: string }>("/insights/dormant/lot", { offerIds, title, priceCents }),
  withdraw: (offerIds: string[]) => post<{ cards: number; listingsEnded: number }>("/insights/dormant/withdraw", { offerIds, confirm: true }),
  home: () => get<HomeInsights>("/insights/home"),
  onboarding: () => get<OnboardingState>("/insights/onboarding"),
  progress: () => get<ProgressView | { hidden: true }>("/insights/progress"),
  seen: (what: { achievements?: boolean; retroMessage?: boolean }) => post<{ ok: true }>("/insights/notifications/seen", what),
  preferences: () => get<Preferences>("/insights/preferences"),
  savePreferences: (change: Partial<Preferences>) => api.raw<Preferences>("PUT", "/insights/preferences", { json: change }),
  recaps: () => get<{ recaps: RecapSummary[] }>("/insights/recaps"),
  recap: (period: string) => get<RecapView>(`/insights/recaps/${period}`),
};

export { formatAmount, formatAmounts, formatMinutes, levelLabel, periodName, salesToGo } from "./insights-format";
