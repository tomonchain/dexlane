import { ArrowRight } from "lucide-react";
import { CTA, PARCEL, SEO, STEPS } from "@/components/landing/content";
import { StepsPanel } from "@/components/landing/landing";
import { pageMetadata } from "@/components/marketing/metadata";
import { Cta, LEAD, SectionTitle, Streaks } from "@/components/marketing/ui";
import { PARCEL_OFFER } from "@/config/plans";
import { SIGNUP_URL } from "@/config/site";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.colis, "/colis", { noindex: true });

/** Page d'arrivée du flyer glissé dans les colis ; le code et l'offre viennent de config/plans.ts. Non indexée. */
export default function ParcelPage() {
  const signup = `${SIGNUP_URL}?code=${encodeURIComponent(PARCEL_OFFER.code)}`;
  return (
    <div className="relative isolate overflow-x-clip">
      <Streaks
        className="top-0 right-[-40vw] -z-10 hidden h-[60%] w-[90vw] sm:block [mask-image:radial-gradient(ellipse_48%_46%_at_58%_55%,black_30%,transparent_100%)]"
        angle={68}
      />
      <div className="mx-auto grid max-w-6xl gap-14 px-4 pt-12 pb-20 sm:px-8 sm:pt-20 sm:pb-28">
        <header className="grid justify-items-start gap-6">
          <SectionTitle as="h1" className="sm:text-6xl">{PARCEL.title}</SectionTitle>
          <p className={LEAD}>{PARCEL.subtitle}</p>
          <Cta href={signup} className="w-full sm:w-auto">{CTA.primary} <ArrowRight /></Cta>
        </header>
        <section aria-labelledby="colis-etapes" className="grid gap-10">
          <SectionTitle id="colis-etapes" className="text-[1.75rem] sm:text-[2.5rem]">{STEPS.title}</SectionTitle>
          <StepsPanel />
        </section>
      </div>
    </div>
  );
}
