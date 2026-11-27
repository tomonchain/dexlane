import { SEO } from "@/components/landing/content";
import { SignupForm, WaitlistForm } from "@/components/marketing/auth-forms";
import { pageMetadata } from "@/components/marketing/metadata";
import { SIGNUP_OPEN } from "@/config/site";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.signup, "/signup");

/**
 * Inscription : adresse e-mail et mot de passe ; le compte s'ouvre une fois l'adresse vérifiée. Inscriptions fermées
 * (`DEXLANE_SIGNUP` ≠ open) : la liste d'attente (#103).
 */
export default function SignupPage() {
  return SIGNUP_OPEN ? <SignupForm /> : <WaitlistForm />;
}
