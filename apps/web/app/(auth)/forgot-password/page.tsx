import { SEO } from "@/components/landing/content";
import { ForgotPasswordForm } from "@/components/marketing/auth-forms";
import { pageMetadata } from "@/components/marketing/metadata";

export const dynamic = "force-static";
export const metadata = pageMetadata(SEO.forgotPassword, "/forgot-password", { noindex: true });

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
