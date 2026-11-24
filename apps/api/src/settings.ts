import type { Db } from "@dexlane/db";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "./notifications";

/** Comment les cartes entrent : scanner à défilement, appareil photo du téléphone, ou fichiers déjà pris. */
export type IntakeMode = "SCANNER" | "CAMERA" | "FILES";

/** Papier des bons de livraison et reçus : rouleau thermique de 80 ou 58 mm, étiquette 100 × 150 mm, ou feuille A4. */
export type SlipPaper = "ROLL_80" | "ROLL_58" | "LABEL_100X150" | "A4";

/** Ce qui s'imprime en tête des bons de livraison et des reçus. */
export interface Seller {
  name: string;
  /** Adresse, une ligne par élément. */
  address: string;
  /** Mention légale du reçu (numéro SIRET, régime de TVA…). */
  legal: string;
}

export interface AppSettings {
  /** L'assistant de démarrage a été terminé (ou passé) : il ne se rouvre plus tout seul. */
  onboardingDone: boolean;
  intakeMode: IntakeMode | null;
  slipPaper: SlipPaper;
  seller: Seller;
  /** Ce qui mérite une notification sur le téléphone. */
  notifications: NotificationPreferences;
}

const DEFAULTS: AppSettings = {
  onboardingDone: false, intakeMode: null, slipPaper: "ROLL_80", seller: { name: "", address: "", legal: "" }, notifications: DEFAULT_NOTIFICATION_PREFERENCES,
};

export async function getAppSettings(sql: Db): Promise<AppSettings> {
  const [row] = await sql<{ settings: Partial<AppSettings> }[]>`select settings from app_settings`;
  return {
    ...DEFAULTS, ...row?.settings,
    seller: { ...DEFAULTS.seller, ...row?.settings.seller },
    notifications: { ...DEFAULTS.notifications, ...row?.settings.notifications },
  };
}

export async function saveAppSettings(sql: Db, change: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getAppSettings(sql)), ...change };
  await sql`
    insert into app_settings (settings) values (${sql.json(next as never)})
    on conflict (id) do update set settings = excluded.settings, updated_at = now()`;
  return next;
}
