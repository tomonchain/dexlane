import { CONTACT, SEO } from "@/components/landing/content";
import { pageMetadata } from "@/components/marketing/metadata";
import { LEAD, SectionTitle } from "@/components/marketing/ui";
import { CONTACT_EMAIL, GITHUB_ISSUES_URL } from "@/config/site";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.contact, "/contact");

/** Contact : l'adresse e-mail et les issues GitHub. Pas de formulaire pour l'instant. */
export default function ContactPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-8 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28">
      <SectionTitle as="h1">{CONTACT.title}</SectionTitle>
      <p className={LEAD}>{CONTACT.text}</p>
      <ul className="grid gap-3 text-lg">
        <li>
          <a href={`mailto:${CONTACT_EMAIL}`} className="border-b border-foreground/40 pb-0.5 font-medium outline-none hover:border-foreground focus-visible:border-foreground">
            {CONTACT_EMAIL}
          </a>
        </li>
        <li>
          <a href={GITHUB_ISSUES_URL} target="_blank" rel="noreferrer" className="border-b border-foreground/40 pb-0.5 font-medium outline-none hover:border-foreground focus-visible:border-foreground">
            {GITHUB_ISSUES_URL.replace(/^https:\/\//, "")}
          </a>
        </li>
      </ul>
    </div>
  );
}
