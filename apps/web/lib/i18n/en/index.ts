import { ACCOUNT } from "./account";
import { CATALOG } from "./catalog";
import { COMMON } from "./common";
import { INTAKE } from "./intake";
import { PRICING } from "./pricing";
import { SALES } from "./sales";
import { SETTINGS } from "./settings";
import { SHELL } from "./shell";
import { STOCK } from "./stock";
import { SUPPLIES } from "./supplies";

/** Dictionnaire anglais complet. Un même texte peut figurer dans plusieurs fichiers : la traduction doit être la même. */
export const EN: Record<string, string> = { ...COMMON, ...SHELL, ...STOCK, ...INTAKE, ...SALES, ...PRICING, ...SETTINGS, ...CATALOG, ...SUPPLIES, ...ACCOUNT };
