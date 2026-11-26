import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout } from "@/components/marketing/auth-layout";
import { UnsubscribeForm } from "@/components/insights/unsubscribe";

export const metadata: Metadata = { title: "Se désinscrire du récap · Dexlane", robots: { index: false, follow: false } };

export default function UnsubscribePage() {
  return (
    <AuthLayout>
      <Suspense>
        <UnsubscribeForm />
      </Suspense>
    </AuthLayout>
  );
}
