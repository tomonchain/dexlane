import { notFound } from "next/navigation";
import { DOCS_INDEX, DOC_PAGES, docPage } from "@/components/docs/content";
import { DocArticle } from "@/components/docs/page";
import { pageMetadata } from "@/components/marketing/metadata";
import { JsonLd, breadcrumb, docArticle, faqPage } from "@/components/marketing/structured-data";

export const dynamic = "force-static";
/** Seules les pages du sommaire existent : une autre adresse sous /docs est une 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const page = docPage((await params).slug);
  if (!page) return {};
  return pageMetadata({ title: `${page.title} — Docs Dexlane`, description: page.lead }, `/docs/${page.slug}`);
}

export default async function DocPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const page = docPage((await params).slug);
  if (!page) notFound();
  const faq = page.sections.flatMap((section) => section.blocks.flatMap((block) => ("faq" in block ? block.faq : [])));
  const crumbs = breadcrumb([
    { name: "Dexlane", path: "/" },
    { name: DOCS_INDEX.title, path: "/docs" },
    { name: page.title, path: `/docs/${page.slug}` },
  ]);
  return (
    <>
      <JsonLd graph={[docArticle(page), crumbs, ...(faq.length ? [faqPage(faq, `/docs/${page.slug}`)] : [])]} />
      <DocArticle page={page} />
    </>
  );
}
