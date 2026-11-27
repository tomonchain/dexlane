import { NextResponse, type NextRequest } from "next/server";
import { EDITION } from "@/config/edition";
import { hasSessionCookie } from "@/lib/session";

/**
 * Avec une session ouverte, la racine sert l'accueil de l'application (app/(app)/home), sans changer l'adresse affichée.
 * Sans session : la page d'accueil publique, rendue statiquement, si l'instance en a une (config/edition.ts) ; sinon la
 * connexion.
 */
export function proxy(request: NextRequest) {
  if (hasSessionCookie(request.cookies)) return NextResponse.rewrite(new URL("/home", request.url));
  return EDITION.landing ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: "/" };
