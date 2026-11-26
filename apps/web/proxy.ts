import { NextResponse, type NextRequest } from "next/server";
import { hasSessionCookie } from "@/lib/session";

/**
 * La racine du site est la landing, rendue statiquement pour les visiteurs. Avec une session ouverte, la même adresse
 * sert l'accueil de l'application (app/(app)/home), sans changer l'adresse affichée.
 */
export function proxy(request: NextRequest) {
  return hasSessionCookie(request.cookies) ? NextResponse.rewrite(new URL("/home", request.url)) : NextResponse.next();
}

export const config = { matcher: "/" };
