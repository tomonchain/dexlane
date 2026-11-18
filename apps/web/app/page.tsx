import { cookies } from "next/headers";
import { Home } from "@/components/home";
import { Landing } from "@/components/landing";
import { SESSION_COOKIE, parseSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Racine du site : la page de présentation pour un visiteur, l'accueil de l'application une fois connecté. */
export default async function RootPage() {
  let signedIn = false;
  try {
    signedIn = parseSession((await cookies()).get(SESSION_COOKIE)?.value) !== null;
  } catch {
    signedIn = false;
  }
  return signedIn ? <Home /> : <Landing />;
}
