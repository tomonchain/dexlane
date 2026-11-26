import { SEO } from "@/components/landing/content";
import { SignupForm } from "@/components/marketing/auth-forms";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.signup, "/signup");

/** Inscription : adresse e-mail et mot de passe ; le compte s'ouvre une fois l'adresse vérifiée. */
export default function SignupPage() {
  return <SignupForm />;
}
