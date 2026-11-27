import { AUTH_SEO } from "@/components/auth/content";
import { ForgotPasswordForm } from "@/components/auth/forms";
import { authMetadata } from "@/components/auth/metadata";

export const dynamic = "force-static";
export const metadata = authMetadata(AUTH_SEO.forgotPassword, "/forgot-password", { noindex: true });

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
