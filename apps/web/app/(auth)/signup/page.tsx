import { AUTH_SEO } from "@/components/auth/content";
import { redirect } from "next/navigation";
import { InviteOnly, SignupForm } from "@/components/auth/forms";
import { authMetadata } from "@/components/auth/metadata";
import { EDITION } from "@/config/edition";
import { SIGNUP_OPEN } from "@/config/site";

export const metadata = authMetadata(AUTH_SEO.signup, "/signup");

/**
 * Inscription : adresse e-mail et mot de passe ; le compte s'ouvre une fois l'adresse vérifiée. Inscriptions fermées
 * (`DEXLANE_SIGNUP` ≠ open) : la liste d'attente de l'édition s'il y en a une, sinon l'inscription sur invitation (#116).
 * Une personne invitée arrive par la connexion (`?invite=1`) et s'inscrit malgré tout : l'API vérifie l'invitation. Page
 * rendue à la demande, puisqu'elle lit l'adresse.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (SIGNUP_OPEN) return <SignupForm />;
  const params = await searchParams;
  if (params.invite) return <SignupForm />;
  if (EDITION.waitlist) {
    const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : []))).toString();
    redirect(query ? `${EDITION.waitlist}?${query}` : EDITION.waitlist);
  }
  return <InviteOnly />;
}
