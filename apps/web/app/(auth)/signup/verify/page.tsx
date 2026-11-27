import { AUTH_SEO } from "@/components/auth/content";
import { VerifyEmail } from "@/components/auth/forms";
import { authMetadata } from "@/components/auth/metadata";

export const dynamic = "force-static";
export const metadata = authMetadata(AUTH_SEO.signup, "/signup/verify", { noindex: true });

/** Arrivée du lien de vérification reçu par e-mail. */
export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
