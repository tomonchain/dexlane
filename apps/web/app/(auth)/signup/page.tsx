import { AUTH_SEO } from "@/components/auth/content";
import { SignupForm, WaitlistForm } from "@/components/auth/forms";
import { authMetadata } from "@/components/auth/metadata";
import { SIGNUP_OPEN } from "@/config/site";

export const dynamic = "force-static";
export const metadata = authMetadata(AUTH_SEO.signup, "/signup");

/**
 * Inscription : adresse e-mail et mot de passe ; le compte s'ouvre une fois l'adresse vérifiée. Inscriptions fermées
 * (`DEXLANE_SIGNUP` ≠ open) : la liste d'attente (#103).
 */
export default function SignupPage() {
  return SIGNUP_OPEN ? <SignupForm /> : <WaitlistForm />;
}
