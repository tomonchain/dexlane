import type { Db } from "@dexlane/db";
import type { CardCondition } from "./internal";

/** Prochain `unit_sku` (« SI-000123 ») et son numéro. Les trous de séquence (transaction annulée) sont sans importance. */
export async function nextUnitSku(tx: Db): Promise<{ unitSku: string; n: number }> {
  const [row] = await tx<{ n: string }[]>`select nextval('unit_sku_seq') as n`;
  const n = Number(row!.n);
  return { unitSku: `SI-${String(n).padStart(6, "0")}`, n };
}

export interface OfferSkuParts {
  setId: string;
  localNumber: string;
  language: string;
  finish: string;
  edition: string;
  promo: boolean;
  stamp: string;
  subtype: string;
  size: string;
  condition: CardCondition;
}

const FINISH_CODES: Record<string, string> = { normal: "N", holo: "H", reverse: "R" };

/** Majuscules ASCII sans accents ni ponctuation : sûr dans un SKU de marketplace. */
const token = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** « sans ombre » → « SO », « illimité#2 » → « I2 ». */
const initials = (s: string) =>
  s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => (/^\d+$/.test(w) ? w : token(w).charAt(0))).join("");

/**
 * SKU lisible d'une offre : `OF-<série>-<numéro>-<langue>-<variante>-<état>`, ex. `OF-BASE1-004-FR-H1-NM`
 * (holo, 1re édition, Near Mint). Sert d'identifiant envoyé aux marketplaces ; l'unicité est garantie
 * par l'appelant (suffixe en cas de collision), pas par ce format.
 */
export function buildOfferSku(p: OfferSkuParts): string {
  const number = /^\d+$/.test(p.localNumber) ? p.localNumber.padStart(3, "0") : token(p.localNumber);
  const variant =
    (FINISH_CODES[p.finish] ?? (token(p.finish).slice(0, 3) || "X")) +
    (p.edition === "1st" ? "1" : token(p.edition).slice(0, 3)) +
    (p.promo ? "P" : "") +
    initials(p.subtype) +
    initials(p.stamp) +
    (p.size === "standard" ? "" : initials(p.size));
  return ["OF", token(p.setId), number, token(p.language), variant, p.condition].join("-");
}
