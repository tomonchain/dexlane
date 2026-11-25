import { SEO } from "@/components/landing/content";
import { VerifyEmail } from "@/components/marketing/auth-forms";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.signup, "/signup/verify", { noindex: true });

/** Arrivée du lien de vérification reçu par e-mail. */
export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
