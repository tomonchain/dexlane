import { SITE_URL } from "@/config/site";
import { publishedGuides } from "@/lib/guides";

export const dynamic = "force-static";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rfc822 = (date: string) => new Date(`${date}T08:00:00Z`).toUTCString();

/** Flux RSS des guides publiés (/guides/rss.xml), pour les lecteurs de flux et les agrégateurs. */
export function GET() {
  const url = (path: string) => new URL(path, SITE_URL).toString();
  const items = publishedGuides().map((g) => `    <item>
      <title>${escape(g.title)}</title>
      <link>${url(`/guides/${g.slug}`)}</link>
      <guid isPermaLink="true">${url(`/guides/${g.slug}`)}</guid>
      <description>${escape(g.description)}</description>
      <pubDate>${rfc822(g.date)}</pubDate>
      <dc:creator>${escape(g.author)}</dc:creator>
    </item>`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Guides Dexlane</title>
    <link>${url("/guides")}</link>
    <description>Guides pratiques pour vendre ses cartes Pokémon : prix, eBay, envois.</description>
    <language>fr-FR</language>
    <atom:link href="${url("/guides/rss.xml")}" rel="self" type="application/rss+xml" />
${items.join("\n")}
  </channel>
</rss>
`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
