import { withTx, type Db } from "@dexlane/db";
import { DomainError } from "@dexlane/shared";

export interface LocationRow {
  id: string;
  parentId: string | null;
  code: string;
  description: string | null;
}

/** pièce → meuble → boîte → rangée → position (spec 4.2). */
export const MAX_LOCATION_DEPTH = 5;
const SEGMENT = /^[A-Z0-9][A-Z0-9-]*$/;

/** « box-03 / row-12 » → « BOX-03/ROW-12 ». Rejette tout ce qui ne peut pas être imprimé/scanné sans ambiguïté. */
export function normalizeLocationCode(raw: string): string {
  const code = raw.trim().toUpperCase().replace(/\s*\/\s*/g, "/");
  const segments = code.split("/");
  if (code.length > 80 || segments.length > MAX_LOCATION_DEPTH || !segments.every((s) => SEGMENT.test(s))) {
    throw new DomainError(
      "INVALID_LOCATION_CODE",
      `invalid location code "${raw}": up to ${MAX_LOCATION_DEPTH} segments of letters, digits and dashes separated by "/"`,
    );
  }
  return code;
}

/**
 * Crée un emplacement et ses parents manquants (« BOX-03/ROW-12 » crée aussi « BOX-03 »).
 * Idempotent : recréer un emplacement existant le renvoie avec `created: false`.
 */
export async function createLocation(
  sql: Db,
  input: { code: string; description?: string },
): Promise<LocationRow & { created: boolean }> {
  const segments = normalizeLocationCode(input.code).split("/");
  return withTx(sql, async (tx) => {
    let parentId: string | null = null;
    let leaf: (LocationRow & { created: boolean }) | undefined;
    for (let depth = 1; depth <= segments.length; depth++) {
      const code = segments.slice(0, depth).join("/");
      const isLeaf = depth === segments.length;
      const [inserted] = await tx<LocationRow[]>`
        insert into locations (code, parent_id, description)
        values (${code}, ${parentId}, ${isLeaf ? (input.description ?? null) : null})
        on conflict (account_id, code) do nothing
        returning id, parent_id, code, description`;
      const row: LocationRow =
        inserted ?? (await tx<LocationRow[]>`select id, parent_id, code, description from locations where code = ${code}`)[0]!;
      parentId = row.id;
      leaf = { ...row, created: !!inserted };
    }
    return leaf!;
  });
}

export type LocationRef = { id: string } | { code: string };

/** Emplacement existant, par identifiant ou par code. Jamais de création implicite : une faute de frappe ne crée pas de boîte. */
export async function resolveLocation(sql: Db, ref: LocationRef): Promise<LocationRow> {
  const [row] =
    "id" in ref
      ? await sql<LocationRow[]>`select id, parent_id, code, description from locations where id = ${ref.id}`
      : await sql<LocationRow[]>`
          select id, parent_id, code, description from locations where code = ${normalizeLocationCode(ref.code)}`;
  if (!row) {
    throw new DomainError("LOCATION_NOT_FOUND", `location ${"id" in ref ? ref.id : ref.code} does not exist`);
  }
  return row;
}

export interface LocationSummary extends LocationRow {
  /** Positions non archivées rangées directement à cet emplacement. */
  positions: number;
  cards: number;
}

export function listLocations(sql: Db, opts: { prefix?: string } = {}): Promise<LocationSummary[]> {
  const prefix = opts.prefix ? normalizeLocationCode(opts.prefix) : null;
  return sql<LocationSummary[]>`
    select l.id, l.parent_id, l.code, l.description,
           count(s.id)::int as positions, coalesce(sum(s.on_hand), 0)::int as cards
      from locations l
      left join stock_items s on s.location_id = l.id and s.lifecycle <> 'ARCHIVED'
     where ${prefix}::text is null or l.code = ${prefix}::text or l.code like ${likePrefix(prefix ?? "")} || '/%'
     group by l.id
     order by l.code`;
}

/** Échappe les jokers LIKE d'une saisie utilisateur. */
export const likePrefix = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Crée plusieurs emplacements d'un coup (et leurs parents), p. ex. les rangées d'une boîte. Tout ou rien. */
export async function createLocations(sql: Db, codes: string[]): Promise<{ created: LocationRow[]; existing: LocationRow[] }> {
  const normalized = [...new Set(codes.map(normalizeLocationCode))];
  return withTx(sql, async (tx) => {
    const created: LocationRow[] = [];
    const existing: LocationRow[] = [];
    for (const code of normalized) {
      const { created: isNew, ...row } = await createLocation(tx, { code });
      (isNew ? created : existing).push(row);
    }
    return { created, existing };
  });
}

export async function updateLocationDescription(sql: Db, id: string, description: string | null): Promise<LocationRow> {
  const [row] = await sql<LocationRow[]>`
    update locations set description = ${description?.trim() || null} where id = ${id}
    returning id, parent_id, code, description`;
  if (!row) throw new DomainError("LOCATION_NOT_FOUND", `location ${id} does not exist`);
  return row;
}

/**
 * Supprime un emplacement créé par erreur. Refusé s'il contient des sous-emplacements ou s'il a déjà servi :
 * le journal des mouvements y fait référence et ne se réécrit pas.
 */
export async function deleteLocation(sql: Db, id: string): Promise<LocationRow> {
  return withTx(sql, async (tx) => {
    const [row] = await tx<LocationRow[]>`select id, parent_id, code, description from locations where id = ${id} for update`;
    if (!row) throw new DomainError("LOCATION_NOT_FOUND", `location ${id} does not exist`);
    const [child] = await tx`select 1 from locations where parent_id = ${id} limit 1`;
    if (child) throw new DomainError("LOCATION_HAS_CHILDREN", `location ${row.code} still has sub-locations`);
    const [used] = await tx`
      select 1 where exists (select 1 from stock_items where location_id = ${id})
                  or exists (select 1 from inventory_movements where from_location_id = ${id} or to_location_id = ${id})`;
    if (used) throw new DomainError("LOCATION_IN_USE", `location ${row.code} has already held stock and cannot be deleted`);
    await tx`delete from locations where id = ${id}`;
    return row;
  });
}
