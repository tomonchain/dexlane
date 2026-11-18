import type { Db } from "@dexlane/db";

/** Comment les cartes entrent : scanner à défilement, appareil photo du téléphone, ou fichiers déjà pris. */
export type IntakeMode = "SCANNER" | "CAMERA" | "FILES";

export interface AppSettings {
  /** L'assistant de démarrage a été terminé (ou passé) : il ne se rouvre plus tout seul. */
  onboardingDone: boolean;
  intakeMode: IntakeMode | null;
}

const DEFAULTS: AppSettings = { onboardingDone: false, intakeMode: null };

export async function getAppSettings(sql: Db): Promise<AppSettings> {
  const [row] = await sql<{ settings: Partial<AppSettings> }[]>`select settings from app_settings`;
  return { ...DEFAULTS, ...row?.settings };
}

export async function saveAppSettings(sql: Db, change: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getAppSettings(sql)), ...change };
  await sql`
    insert into app_settings (settings) values (${sql.json(next as never)})
    on conflict (id) do update set settings = excluded.settings, updated_at = now()`;
  return next;
}
