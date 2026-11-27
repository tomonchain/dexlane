import { AUTH_SEO } from "@/components/auth/content";
import { ResetPasswordForm } from "@/components/auth/forms";
import { authMetadata } from "@/components/auth/metadata";

export const dynamic = "force-static";
export const metadata = authMetadata(AUTH_SEO.forgotPassword, "/reset-password", { noindex: true });

/** Arrivée du lien de réinitialisation reçu par e-mail. */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
