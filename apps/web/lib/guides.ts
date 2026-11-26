import "server-only";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Marked, type Tokens } from "marked";
import { slugify } from "@dexlane/catalog";

/**
 * Guides du site (/guides) : un fichier Markdown par article dans `apps/web/content/guides`, le nom du fichier donnant
 * l'adresse (`vendre-sur-ebay.md` → /guides/vendre-sur-ebay). Les fichiers qui commencent par `_` sont ignorés (modèle).
 *
 * En-tête obligatoire, entre deux lignes `---` :
 *   title: Titre de l'article
 *   description: Une ou deux phrases, pour l'index et les moteurs
 *   date: 2026-12-01            (date de publication)
 *   author: Thomas
 *   updated: 2026-12-15         (facultatif : dernière mise à jour)
 *   draft: true                 (facultatif : brouillon, visible partout sauf en production)
 */

export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** AAAA-MM-JJ. */
  date: string;
  updated: string | null;
  author: string;
  draft: boolean;
  /** Le texte Markdown, sans l'en-tête. */
  markdown: string;
  /** Rendu HTML, titres de section numérotés pour le sommaire. */
  html: string;
  /** Sections de niveau 2, pour le sommaire. */
  toc: { id: string; title: string }[];
  /** Minutes de lecture, à 220 mots par minute. */
  readingMinutes: number;
}

const DIR = join(process.cwd(), "content", "guides");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** En-tête `clé: valeur` entre deux lignes `---` (un sous-ensemble de YAML suffit ici). */
export function parseFrontmatter(source: string): { data: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!match) return { data: {}, body: source };
  const data: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) data[kv[1]!] = kv[2]!.replace(/^["'](.*)["']$/, "$1").trim();
  }
  return { data, body: match[2]! };
}

function render(markdown: string): { html: string; toc: Guide["toc"] } {
  const toc: Guide["toc"] = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>\n`;
        const id = slugify(text) || `section-${toc.length + 1}`;
        if (depth === 2) toc.push({ id, title: text.replace(/[*_`]/g, "") });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.startsWith("https://dexlane.app");
        const attrs = [`href="${href}"`, title ? `title="${title}"` : "", external ? `target="_blank" rel="noopener noreferrer"` : ""];
        return `<a ${attrs.filter(Boolean).join(" ")}>${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        return `<img src="${href}" alt="${text}"${title ? ` title="${title}"` : ""} loading="lazy" decoding="async" />`;
      },
    },
  });
  return { html: marked.parse(markdown, { async: false }), toc };
}

function load(file: string): Guide {
  const { data, body } = parseFrontmatter(readFileSync(join(DIR, file), "utf8"));
  const slug = file.replace(/\.md$/, "");
  for (const key of ["title", "description", "date", "author"]) {
    if (!data[key]) throw new Error(`guide ${file}: « ${key} » manque dans l'en-tête`);
  }
  if (!DATE.test(data.date!)) throw new Error(`guide ${file}: date attendue au format AAAA-MM-JJ`);
  if (data.updated && !DATE.test(data.updated)) throw new Error(`guide ${file}: updated attendue au format AAAA-MM-JJ`);
  const { html, toc } = render(body);
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    slug, title: data.title!, description: data.description!, date: data.date!, updated: data.updated || null,
    author: data.author!, draft: data.draft === "true", markdown: body.trim(), html, toc,
    readingMinutes: Math.max(1, Math.round(words / 220)),
  };
}

/** Les brouillons se relisent en local et en préversion ; la production ne publie que les articles terminés. */
export const showDrafts = () => process.env.VERCEL_ENV !== "production";

/** Tous les guides visibles ici, les plus récents d'abord. */
export function listGuides(): Guide[] {
  let files: string[] = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  } catch {
    return [];
  }
  return files
    .map(load)
    .filter((g) => showDrafts() || !g.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

export const getGuide = (slug: string) => listGuides().find((g) => g.slug === slug) ?? null;
/** Guides publiés (hors brouillons), pour le plan du site, le flux RSS et les liens du site. */
export const publishedGuides = () => listGuides().filter((g) => !g.draft);

const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
export const formatGuideDate = (date: string) => day.format(new Date(`${date}T12:00:00Z`));
