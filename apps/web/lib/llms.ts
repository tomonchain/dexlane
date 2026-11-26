/**
 * Le site public en Markdown pour les moteurs génératifs (convention llms.txt) : /llms.txt présente Dexlane et liste
 * les pages ; /llms-full.txt contient toute la documentation. Tiré des contenus du site, donc toujours à jour.
 */
import { DOC_GROUPS, DOC_PAGES, DOCS_INDEX, type DocBlock, type DocPage } from "@/components/docs/content";
import { FAQ, SEO } from "@/components/landing/content";
import { PLANS, formatCards, formatPlanPrice } from "@/config/plans";
import { SITE_URL } from "@/config/site";
import { publishedGuides } from "@/lib/guides";

const url = (path: string) => new URL(path, SITE_URL).toString();
/** Les liens internes des textes (`[x](/docs/…)`) deviennent absolus : le fichier est lu hors du site. */
const absolute = (s: string) => s.replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${url(path)})`);

function block(b: DocBlock): string {
  if ("p" in b) return absolute(b.p);
  if ("list" in b) return b.list.map((item) => `- ${absolute(item)}`).join("\n");
  if ("steps" in b) return b.steps.map((item, i) => `${i + 1}. ${absolute(item)}`).join("\n");
  if ("code" in b) return `${b.label ? `${b.label} :\n\n` : ""}\`\`\`\n${b.code}\n\`\`\``;
  if ("note" in b) return `> ${absolute(b.note)}`;
  if ("table" in b) {
    const row = (cells: string[]) => `| ${cells.map((c) => absolute(c).replace(/\|/g, "\\|")).join(" | ")} |`;
    return [row(b.table.head), row(b.table.head.map(() => "---")), ...b.table.rows.map(row)].join("\n");
  }
  return b.faq.map((item) => `**${item.q}**\n\n${absolute(item.a)}`).join("\n\n");
}

export function docMarkdown(page: DocPage): string {
  const sections = page.sections.map((s) => `### ${s.title}\n\n${s.blocks.map(block).join("\n\n")}`);
  return [`## ${page.title}`, `Source : ${url(`/docs/${page.slug}`)}`, absolute(page.lead), ...sections].join("\n\n");
}

const plans = () =>
  PLANS.map((p) => `- **${p.name}** : ${formatPlanPrice(p)}, ${formatCards(p.cardsPerMonth)} cartes publiées et ${formatCards(p.scansPerMonth)} scans par mois. ${p.pitch}.`).join("\n");

/** Les guides publiés, s'il y en a. */
function guidesSection(): string[] {
  const guides = publishedGuides();
  return guides.length === 0 ? [] : [`## Guides\n\n${guides.map((g) => `- [${g.title}](${url(`/guides/${g.slug}`)}) : ${g.description}`).join("\n")}`];
}

/** /llms.txt : présentation, forfaits, pages clés et sommaire de la doc. */
export function llmsIndex(): string {
  const docs = DOC_GROUPS.map((group) => {
    const pages = DOC_PAGES.filter((p) => p.group === group.id);
    return `## ${group.title}\n\n${pages.map((p) => `- [${p.title}](${url(`/docs/${p.slug}`)}) : ${absolute(p.lead)}`).join("\n")}`;
  });
  return [
    "# Dexlane",
    `> ${SEO.landing.description}`,
    `Dexlane est une application web (et installable sur téléphone) pour les vendeurs de cartes Pokémon : scan des cartes, entrée en stock et rangement, prix calculés d'après les cotes du marché, publication et synchronisation des annonces eBay, ventes et envois. Version hébergée sur ${url("/")}, version Community auto-hébergeable, serveur MCP pour les agents.`,
    `## Forfaits\n\n${plans()}\n\nDétail : ${url("/tarifs")}`,
    `## Pages\n\n- [Accueil](${url("/")})\n- [Tarifs](${url("/tarifs")})\n- [${DOCS_INDEX.title}](${url("/docs")})\n- [Séries et cotes des cartes Pokémon](${url("/series")}) : chaque série en français, ses cartes et leur cote Cardmarket du jour\n- [Contact](${url("/contact")})\n- [Documentation complète en Markdown](${url("/llms-full.txt")})`,
    ...docs,
    ...guidesSection(),
  ].join("\n\n") + "\n";
}

/** /llms-full.txt : présentation, FAQ et toute la documentation. */
export function llmsFull(): string {
  const faq = FAQ.items.map((item) => `**${item.q}**\n\n${absolute(item.a)}`).join("\n\n");
  return [
    "# Dexlane — documentation complète",
    `> ${SEO.landing.description}`,
    `## Forfaits\n\n${plans()}`,
    `## ${FAQ.title}\n\n${faq}`,
    ...DOC_PAGES.map(docMarkdown),
    ...publishedGuides().map((g) => `## ${g.title}\n\nSource : ${url(`/guides/${g.slug}`)} — ${g.author}, ${g.updated ?? g.date}\n\n${absolute(g.markdown).replace(/^## /gm, "### ")}`),
  ].join("\n\n") + "\n";
}

export function markdownResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
