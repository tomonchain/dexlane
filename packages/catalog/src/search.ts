import type { Db } from "@dexlane/db";

/** Une variante trouvée par la recherche libre : de quoi la reconnaître et la choisir. */
export interface CatalogHit {
  variantId: string;
  catalogCardId: string;
  name: string;
  setId: string;
  setName: string | null;
  localNumber: string;
  language: string;
  rarity: string | null;
  imageUrl: string | null;
  finish: string;
  edition: string;
  subtype: string;
  stamp: string;
  incomplete: boolean;
  /** Le nom de la carte commence par le premier mot cherché : à montrer avant les correspondances partielles. */
  prefix: boolean;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * Recherche libre dans le catalogue importé, en une seule saisie : « dracaufeu », « dracaufeu 4/102 », « mew 151 »,
 * « fouinar ténèbres ». Un nombre (avec ou sans total) désigne le numéro de la carte ; chaque autre mot doit se trouver
 * dans le nom, dans le nom de la série, ou être le code de la série. Accents et majuscules sont ignorés.
 */
export async function searchCatalog(sql: Db, query: string, opts: { language?: string; limit?: number } = {}): Promise<CatalogHit[]> {
  const raw = query.trim().toLowerCase();
  if (raw.length < 2) return [];
  const numberMatch = raw.match(/(?:^|\s)(\d{1,4})(?:\s*\/\s*\d{1,4})?(?=\s|$)/);
  const number = numberMatch?.[1]?.replace(/^0+(?=\d)/, "") ?? null;
  const words = (numberMatch ? raw.replace(numberMatch[0], " ") : raw).split(/\s+/).filter((w) => w.length > 0).slice(0, 5);
  if (words.length === 0 && number === null) return [];
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const conditions = words.map((w) => sql`and (
    f_unaccent(lower(c.name)) like '%' || f_unaccent(${likeEscape(w)}) || '%'
    or f_unaccent(lower(coalesce(st.name, ''))) like '%' || f_unaccent(${likeEscape(w)}) || '%'
    or lower(c.set_id) = ${w} or lower(coalesce(st.abbreviation, '')) = ${w} or lower(coalesce(st.abbreviation_localized, '')) = ${w})`);
  const first = words[0] ?? "";
  return sql<CatalogHit[]>`
    select v.id as variant_id, c.id as catalog_card_id, c.name, c.set_id, st.name as set_name, c.local_number, c.language, c.rarity,
           c.image_url, v.finish, v.edition, v.subtype, v.stamp, v.incomplete,
           (${first} <> '' and f_unaccent(lower(c.name)) like f_unaccent(${likeEscape(first)}) || '%') as prefix
      from catalog_cards c
      join card_variants v on v.catalog_card_id = c.id
      left join catalog_sets st on st.id = c.set_id and st.language = c.language
     where true
       ${opts.language ? sql`and c.language = ${opts.language}` : sql``}
       ${number !== null ? sql`and coalesce(nullif(ltrim(c.local_number, '0'), ''), '0') = ${number}` : sql``}
       ${conditions.reduce((all, condition) => sql`${all} ${condition}`, sql``)}
     order by prefix desc, c.name, st.release_date desc nulls last, c.local_number, v.finish, v.edition
     limit ${limit}`;
}
