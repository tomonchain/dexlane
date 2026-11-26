import { notFound } from "next/navigation";
import { DOC_PAGES, docPage } from "@/components/docs/content";
import { DocArticle } from "@/components/docs/page";
import { pageMetadata } from "@/components/marketing/metadata";

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
  return <DocArticle page={page} />;
}
