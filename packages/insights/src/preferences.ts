import type { Db } from "@dexlane/db";
import { defaultTimezone, recapEmailDefault } from "./config/progression";
import { checkTimezone } from "./sql";

/** Réglages propres à chaque utilisateur d'un compte (table `user_preferences`). */
export interface UserPreferences {
  timezone: string;
  /** « Afficher le niveau et les succès ». */
  showProgression: boolean;
  /** E-mail qui annonce le récap du mois. */
  recapEmail: boolean;
  /** Bloc de démarrage masqué de l'accueil. */
  onboardingHidden: boolean;
  achievementsSeenAt: Date | null;
  retroMessageSeenAt: Date | null;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: defaultTimezone, showProgression: true, recapEmail: recapEmailDefault, onboardingHidden: false,
  achievementsSeenAt: null, retroMessageSeenAt: null,
};

/** Réglages d'un utilisateur ; sans utilisateur (script, tâche planifiée), les réglages par défaut. */
export async function getPreferences(sql: Db, userId: string | null | undefined): Promise<UserPreferences> {
  if (!userId) return DEFAULT_PREFERENCES;
  const [row] = await sql<UserPreferences[]>`
    select timezone, show_progression, recap_email, onboarding_hidden, achievements_seen_at, retro_message_seen_at
      from user_preferences where user_id = ${userId}`;
  return row ?? DEFAULT_PREFERENCES;
}

export type PreferencesChange = Partial<Pick<UserPreferences, "timezone" | "showProgression" | "recapEmail" | "onboardingHidden">> & {
  /** Les succès débloqués jusqu'ici ont été annoncés. */
  achievementsSeen?: boolean;
  retroMessageSeen?: boolean;
};

export async function savePreferences(sql: Db, userId: string, change: PreferencesChange): Promise<UserPreferences> {
  const next = { ...(await getPreferences(sql, userId)) };
  if (change.timezone !== undefined) next.timezone = checkTimezone(change.timezone);
  if (change.showProgression !== undefined) next.showProgression = change.showProgression;
  if (change.recapEmail !== undefined) next.recapEmail = change.recapEmail;
  if (change.onboardingHidden !== undefined) next.onboardingHidden = change.onboardingHidden;
  if (change.achievementsSeen) next.achievementsSeenAt = new Date();
  if (change.retroMessageSeen) next.retroMessageSeenAt = next.retroMessageSeenAt ?? new Date();
  await sql`
    insert into user_preferences (user_id, timezone, show_progression, recap_email, onboarding_hidden, achievements_seen_at, retro_message_seen_at)
    values (${userId}, ${next.timezone}, ${next.showProgression}, ${next.recapEmail}, ${next.onboardingHidden}, ${next.achievementsSeenAt}, ${next.retroMessageSeenAt})
    on conflict (account_id, user_id) do update set
      timezone = excluded.timezone, show_progression = excluded.show_progression, recap_email = excluded.recap_email,
      onboarding_hidden = excluded.onboarding_hidden, achievements_seen_at = excluded.achievements_seen_at,
      retro_message_seen_at = excluded.retro_message_seen_at, updated_at = now()`;
  return next;
}
