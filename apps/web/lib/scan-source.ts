import { planCards, type PlannedCard } from "@dexlane/scan/order";

const IMAGE = /\.(jpe?g|png|webp)$/i;
export const isScanFile = (name: string) => IMAGE.test(name) && !name.startsWith(".");

/** Le navigateur sait-il lire un dossier en continu (Chrome, Edge) ? */
export const canWatchFolder = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

interface DirectoryHandle {
  name: string;
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string; getFile(): Promise<File> }>;
}

export async function pickFolder(): Promise<DirectoryHandle | null> {
  try {
    return await (window as unknown as { showDirectoryPicker(o: object): Promise<DirectoryHandle> }).showDirectoryPicker({ mode: "read" });
  } catch {
    return null; // sélection annulée
  }
}

/** Fichiers image du dossier, par nom. */
export async function readFolder(folder: DirectoryHandle): Promise<Map<string, File>> {
  const files = new Map<string, File>();
  for await (const entry of folder.values()) {
    if (entry.kind === "file" && isScanFile(entry.name)) files.set(entry.name, await entry.getFile());
  }
  return files;
}

export interface FolderCard extends PlannedCard {
  frontFile: File;
  backFile: File | null;
  /** Photos prises au téléphone : la carte y est repérée, redressée et recadrée avant l'envoi. */
  fromCamera?: boolean;
}

/**
 * Cartes complètes présentes dans le dossier, dans l'ordre du scanner.
 * - `ignored` : fichiers déjà là quand le dossier a été relié (ils appartiennent à un lot précédent) ;
 * - `sizes` : tailles relevées au passage précédent. Un fichier dont la taille bouge encore est en cours d'écriture :
 *   lui et tous ceux qui le suivent attendent, pour ne jamais décaler l'ordre.
 */
export function cardsInFolder(files: Map<string, File>, ignored: Set<string>, sizes: Map<string, number>, paired: boolean): FolderCard[] {
  const names = [...files.keys()].filter((name) => !ignored.has(name));
  const cards: FolderCard[] = [];
  for (const card of planCards(names, paired)) {
    const frontFile = files.get(card.front)!;
    const backFile = card.back ? files.get(card.back)! : null;
    const stable = [frontFile, backFile].every((f) => !f || (f.size > 0 && sizes.get(f.name) === f.size));
    if (!stable) break;
    cards.push({ ...card, frontFile, backFile });
  }
  for (const [name, file] of files) sizes.set(name, file.size);
  return cards;
}

/** Cartes d'une sélection manuelle de fichiers, à la suite des `after` cartes déjà enregistrées. */
export function cardsFromFiles(list: File[], paired: boolean, after: number): FolderCard[] {
  const byName = new Map(list.filter((f) => isScanFile(f.name)).map((f) => [f.name, f]));
  return planCards([...byName.keys()], paired).map((card) => ({
    ...card, position: card.position + after, frontFile: byName.get(card.front)!, backFile: card.back ? byName.get(card.back)! : null,
  }));
}
