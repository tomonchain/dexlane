import { SEO } from "@/components/landing/content";
import { ResetPasswordForm } from "@/components/marketing/auth-forms";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.forgotPassword, "/reset-password", { noindex: true });

/** Arrivée du lien de réinitialisation reçu par e-mail. */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
