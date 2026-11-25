import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/session";

/**
 * La racine du site est la landing, rendue statiquement pour les visiteurs. Avec une session ouverte, la même adresse
 * sert l'accueil de l'application (app/(app)/home), sans changer l'adresse affichée.
 */
export function proxy(request: NextRequest) {
  let signedIn = false;
  try {
    signedIn = readSession(request) !== null;
  } catch {
    signedIn = false; // serveur sans jeton configuré : tout visiteur voit la landing
  }
  return signedIn ? NextResponse.rewrite(new URL("/home", request.url)) : NextResponse.next();
}

export const config = { matcher: "/" };
